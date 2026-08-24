import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseMarkdownTable } from '@/lib/markdown-parser'
import { getMonday, normalizeWorkoutType } from '@/lib/types'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// Resolve an optional yyyy-mm-dd week string to that week's Monday.
// Missing/empty -> current week's Monday. Malformed -> null (caller returns 400).
// Local midnight construction — never new Date('yyyy-mm-dd'), which parses as UTC.
function resolveMonday(weekStart: unknown): Date | null {
  if (weekStart === undefined || weekStart === null || weekStart === '') {
    return getMonday(new Date())
  }
  if (typeof weekStart !== 'string' || !YMD_RE.test(weekStart)) return null
  const date = new Date(weekStart + 'T00:00:00')
  if (Number.isNaN(date.getTime())) return null
  return getMonday(date)
}

interface PlanRowData {
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const monday = resolveMonday(searchParams.get('week'))

  if (!monday) {
    return NextResponse.json({ errors: ['Invalid week date; expected yyyy-mm-dd'] }, { status: 400 })
  }

  const plan = await prisma.weekPlan.findFirst({
    where: {
      weekStartDate: monday
    },
    include: {
      rows: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  })

  return NextResponse.json(plan)
}

// Body is a discriminated union:
//   { markdown: string, weekStart?: string }
//   { rows: { day, type, notes, exercise, setsText, repsTimeText }[], weekStart?: string }
//   { copyFromWeek: 'last', weekStart?: string }
export async function POST(request: NextRequest) {
  const body = await request.json()

  const monday = resolveMonday(body?.weekStart)
  if (!monday) {
    return NextResponse.json({ errors: ['Invalid weekStart date; expected yyyy-mm-dd'] }, { status: 400 })
  }

  let rowsData: PlanRowData[]

  if (typeof body?.markdown === 'string') {
    const result = parseMarkdownTable(body.markdown)

    if (!result.success) {
      return NextResponse.json({ errors: result.errors }, { status: 400 })
    }

    // Types must be canonicalizable, or the saved rows can never be logged
    // (/api/logs rejects unknown types). Store the canonical value.
    const typeErrors: string[] = []
    rowsData = result.rows.map((row, index) => {
      const canonicalType = normalizeWorkoutType(row.type)
      if (canonicalType === null) {
        typeErrors.push(`Row ${index + 1}: Unknown workout type: ${row.type} (use Gym, Run, Circuit or Activity)`)
      }
      return {
        day: row.day,
        type: canonicalType ?? row.type,
        notes: row.notes,
        exercise: row.exercise,
        setsText: row.sets,
        repsTimeText: row.repsTime
      }
    })

    if (typeErrors.length > 0) {
      return NextResponse.json({ errors: typeErrors }, { status: 400 })
    }
  } else if (Array.isArray(body?.rows)) {
    const errors: string[] = []

    rowsData = (body.rows as Record<string, unknown>[]).map((row, index) => {
      const day = typeof row.day === 'string' ? row.day.trim() : ''
      const exercise = typeof row.exercise === 'string' ? row.exercise.trim() : ''
      const rawType = typeof row.type === 'string' ? row.type : ''
      const canonicalType = normalizeWorkoutType(rawType)

      if (!day) errors.push(`Row ${index + 1}: Day is required`)
      if (!exercise) errors.push(`Row ${index + 1}: Exercise is required`)
      if (canonicalType === null) errors.push(`Row ${index + 1}: Unknown workout type: ${rawType}`)

      return {
        day,
        type: canonicalType ?? '',
        notes: typeof row.notes === 'string' ? row.notes : '',
        exercise,
        setsText: typeof row.setsText === 'string' ? row.setsText : '',
        repsTimeText: typeof row.repsTimeText === 'string' ? row.repsTimeText : ''
      }
    })

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 })
    }
  } else if (body?.copyFromWeek === 'last') {
    const previous = await prisma.weekPlan.findFirst({
      where: { weekStartDate: { lt: monday } },
      orderBy: { weekStartDate: 'desc' },
      include: {
        rows: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    })

    if (!previous) {
      return NextResponse.json({ errors: ['No previous plan to copy'] }, { status: 404 })
    }

    // Canonicalize legacy free-text types where possible ('Gym A' -> 'Gym'),
    // but never hard-fail the copy over one odd legacy row — keep it verbatim.
    rowsData = previous.rows.map(row => ({
      day: row.day,
      type: normalizeWorkoutType(row.type) ?? row.type,
      notes: row.notes,
      exercise: row.exercise,
      setsText: row.setsText,
      repsTimeText: row.repsTimeText
    }))
  } else {
    return NextResponse.json(
      { errors: ['Request body must include markdown, rows, or copyFromWeek'] },
      { status: 400 }
    )
  }

  // Replace the target week's plan atomically.
  const [, plan] = await prisma.$transaction([
    prisma.weekPlan.deleteMany({
      where: { weekStartDate: monday }
    }),
    prisma.weekPlan.create({
      data: {
        weekStartDate: monday,
        rows: {
          create: rowsData.map((row, index) => ({
            ...row,
            sortOrder: index
          }))
        }
      },
      include: {
        rows: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    })
  ])

  return NextResponse.json(plan)
}

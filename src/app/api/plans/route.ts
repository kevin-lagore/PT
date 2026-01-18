import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseMarkdownTable, ParsedRow } from '@/lib/markdown-parser'
import { getMonday } from '@/lib/types'

export async function GET() {
  const monday = getMonday(new Date())

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

export async function POST(request: NextRequest) {
  const { markdown } = await request.json()

  const result = parseMarkdownTable(markdown)

  if (!result.success) {
    return NextResponse.json({ errors: result.errors }, { status: 400 })
  }

  const monday = getMonday(new Date())

  // Delete existing plan for this week
  await prisma.weekPlan.deleteMany({
    where: { weekStartDate: monday }
  })

  // Create new plan
  const plan = await prisma.weekPlan.create({
    data: {
      weekStartDate: monday,
      rows: {
        create: result.rows.map((row: ParsedRow, index: number) => ({
          day: row.day,
          type: row.type,
          notes: row.notes,
          exercise: row.exercise,
          setsText: row.sets,
          repsTimeText: row.repsTime,
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

  return NextResponse.json(plan)
}

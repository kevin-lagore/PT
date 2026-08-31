import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { formatDate, getMonday } from '@/lib/types'
import { generateWeekRows, reconstructRowsFromLogs } from '@/lib/generate'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// Resolve an optional yyyy-mm-dd week string to that week's Monday.
// Missing/empty -> current week's Monday. Malformed -> null (caller returns 400).
// Local midnight construction — never new Date('yyyy-mm-dd'), which parses as UTC.
// (Mirrors /api/plans exactly.)
function resolveMonday(weekStart: unknown): Date | null {
  if (weekStart === undefined || weekStart === null || weekStart === '') {
    return getMonday(new Date())
  }
  if (typeof weekStart !== 'string' || !YMD_RE.test(weekStart)) return null
  const date = new Date(weekStart + 'T00:00:00')
  if (Number.isNaN(date.getTime())) return null
  return getMonday(date)
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDayMonth(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`
}

// POST /api/plans/generate — body: { weekStart?: 'yyyy-mm-dd' }.
// Previews next week's generated rows; NEVER saves. The client saves the
// preview via the existing POST /api/plans { rows, weekStart } body, which
// validates and canonicalizes types.
export async function POST(request: NextRequest) {
  // Tolerate an empty body — the common call is a bare POST {}.
  const body = await request.json().catch(() => ({}))

  const monday = resolveMonday(body?.weekStart)
  if (!monday) {
    return NextResponse.json({ errors: ['Invalid weekStart date; expected yyyy-mm-dd'] }, { status: 400 })
  }

  // Progression history: logs from the 90 days before the target Monday.
  const historyStart = new Date(monday)
  historyStart.setDate(historyStart.getDate() - 90)

  const [sourcePlan, historyLogs] = await Promise.all([
    // Source structure: the most recent plan before the target week.
    prisma.weekPlan.findFirst({
      where: { weekStartDate: { lt: monday } },
      orderBy: { weekStartDate: 'desc' },
      include: {
        rows: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    }),
    prisma.logEntry.findMany({
      where: { date: { gte: historyStart, lt: monday } },
      select: {
        date: true,
        type: true,
        exerciseOrActivity: true,
        setsCompleted: true,
        reps: true,
        weight: true,
        km: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    })
  ])

  if (sourcePlan) {
    const sourceMonday = new Date(sourcePlan.weekStartDate)
    const sourceSunday = new Date(sourceMonday)
    sourceSunday.setDate(sourceSunday.getDate() + 6)
    sourceSunday.setHours(23, 59, 59, 999)

    // Source-week logs drive the sets bump + run nudge. Queried separately
    // because the source plan can be older than the 90-day history window.
    const sourceWeekLogs = await prisma.logEntry.findMany({
      where: { date: { gte: sourceMonday, lte: sourceSunday } },
      select: { date: true, type: true }
    })

    const sourceRows = sourcePlan.rows.map(row => ({
      day: row.day,
      type: row.type,
      notes: row.notes,
      exercise: row.exercise,
      setsText: row.setsText,
      repsTimeText: row.repsTimeText
    }))

    const result = generateWeekRows(sourceRows, historyLogs, sourceWeekLogs)

    return NextResponse.json({
      rows: result.rows,
      basedOn: {
        sourceWeekStart: formatDate(sourceMonday),
        notes: [`Based on the week of ${formatDayMonth(sourceMonday)}`, ...result.notes]
      }
    })
  }

  // No plan on record: reconstruct a source structure from the last 28 days of logs.
  const reconstructStart = new Date(monday)
  reconstructStart.setDate(reconstructStart.getDate() - 28)
  const recentLogs = historyLogs.filter(log => log.date >= reconstructStart)

  if (recentLogs.length === 0) {
    return NextResponse.json({ errors: ['No workout history to generate from'] }, { status: 404 })
  }

  const result = generateWeekRows(reconstructRowsFromLogs(recentLogs), historyLogs, [])

  return NextResponse.json({
    rows: result.rows,
    basedOn: {
      sourceWeekStart: null,
      notes: ['Based on your logs from the last 28 days', ...result.notes]
    }
  })
}

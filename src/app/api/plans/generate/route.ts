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

  const [recentPlans, historyLogs] = await Promise.all([
    // The last 3 plans before the target week, newest first. The first one is
    // the source structure; all of them feed the generator's rotation rules
    // (main lifts rotate only after a finished 3-week block).
    prisma.weekPlan.findMany({
      where: { weekStartDate: { lt: monday } },
      orderBy: { weekStartDate: 'desc' },
      take: 3,
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
        durationMin: true,
        stravaData: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    })
  ])

  const sourcePlan = recentPlans[0]

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

    // Rows of the recent plans (newest first) as plain GenRow arrays; index 0
    // doubles as the source structure.
    const recentPlanRows = recentPlans.map(plan =>
      plan.rows.map(row => ({
        day: row.day,
        type: row.type,
        notes: row.notes,
        exercise: row.exercise,
        setsText: row.setsText,
        repsTimeText: row.repsTimeText
      }))
    )

    const result = generateWeekRows(recentPlanRows[0], historyLogs, sourceWeekLogs, {
      targetWeekStartYmd: formatDate(monday),
      recentPlanRows
    })

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

  // No saved plans exist here, so recentPlanRows is empty — the generator
  // keeps this reconstruction path rotation-free.
  const result = generateWeekRows(reconstructRowsFromLogs(recentLogs), historyLogs, [], {
    targetWeekStartYmd: formatDate(monday),
    recentPlanRows: []
  })

  return NextResponse.json({
    rows: result.rows,
    basedOn: {
      sourceWeekStart: null,
      notes: ['Based on your logs from the last 28 days', ...result.notes]
    }
  })
}

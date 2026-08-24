import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMonday, formatDate, normalizeExerciseName, normalizeWorkoutType, LastEntry } from '@/lib/types'
import { computeStreakInfo } from '@/lib/streaks'

// Slim shape of a pre-week log used to build LastEntry per plan row.
interface PriorLog {
  date: Date
  exerciseOrActivity: string
  reps: number | null
  weight: number | null
  km: number | null
  setsCompleted: number | null
  createdAt: Date
}

export async function GET() {
  const now = new Date()
  const monday = getMonday(now)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  // ~1 year of log dates (slim select) for streak computation.
  const yearAgo = new Date(now)
  yearAgo.setDate(yearAgo.getDate() - 365)
  yearAgo.setHours(0, 0, 0, 0)

  // Logs in the 365 days BEFORE this week's Monday, for per-row lastEntry.
  // Exercise-name matching is fuzzy (normalizeExerciseName), so we cannot filter
  // by name in SQL — fetch the slim window once and bucket in JS.
  const yearBeforeMonday = new Date(monday)
  yearBeforeMonday.setDate(yearBeforeMonday.getDate() - 365)

  const [plan, logs, streakDateRows, priorLogs] = await Promise.all([
    // Current week's plan with this week's logs attached per row.
    prisma.weekPlan.findFirst({
      where: {
        weekStartDate: monday
      },
      include: {
        rows: {
          orderBy: { sortOrder: 'asc' },
          include: {
            logEntries: {
              where: {
                date: {
                  gte: monday,
                  lte: sunday
                }
              }
            }
          }
        }
      }
    }),
    // All logs for the week (including unlinked ones).
    prisma.logEntry.findMany({
      where: {
        date: {
          gte: monday,
          lte: sunday
        }
      },
      orderBy: { date: 'desc' }
    }),
    prisma.logEntry.findMany({
      where: { date: { gte: yearAgo } },
      select: { date: true }
    }),
    prisma.logEntry.findMany({
      where: { date: { gte: yearBeforeMonday, lt: monday } },
      select: {
        date: true,
        exerciseOrActivity: true,
        reps: true,
        weight: true,
        km: true,
        setsCompleted: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    })
  ])

  const streakInfo = computeStreakInfo(streakDateRows.map(row => row.date), now)

  // Bucket prior logs by normalized exercise name.
  const priorByName = new Map<string, PriorLog[]>()
  for (const log of priorLogs) {
    const key = normalizeExerciseName(log.exerciseOrActivity)
    const bucket = priorByName.get(key)
    if (bucket) bucket.push(log)
    else priorByName.set(key, [log])
  }

  // Local midnight — never new Date('yyyy-mm-dd'), which parses as UTC midnight.
  const todayLocal = new Date(formatDate(now) + 'T00:00:00')

  const buildLastEntry = (row: { exercise: string; type: string }): LastEntry | null => {
    const entries = priorByName.get(normalizeExerciseName(row.exercise))
    if (!entries || entries.length === 0) return null

    // Most recent LOCAL session date for this exercise.
    let lastDate = ''
    for (const entry of entries) {
      const d = formatDate(entry.date)
      if (d > lastDate) lastDate = d
    }

    // That session's entries, already in createdAt (logged) order from the query.
    const session = entries.filter(entry => formatDate(entry.date) === lastDate)

    const type = normalizeWorkoutType(row.type)

    const sets: { reps: number | null; weight: number | null }[] = []
    if (type === 'Gym') {
      for (const entry of session) {
        // An entry logged with setsCompleted > 1 counts as that many identical sets.
        const count = entry.setsCompleted != null && entry.setsCompleted > 1 ? entry.setsCompleted : 1
        for (let i = 0; i < count; i++) {
          sets.push({ reps: entry.reps, weight: entry.weight })
        }
      }
    }

    let km: number | null = null
    if (type === 'Run') {
      for (const entry of session) {
        if (entry.km != null) km = entry.km
      }
    }

    const daysAgo = Math.round(
      (todayLocal.getTime() - new Date(lastDate + 'T00:00:00').getTime()) / 86_400_000
    )

    return { date: lastDate, daysAgo, sets, km }
  }

  // Calculate weekly XP
  const weeklyXP = logs.reduce((sum, log) => sum + log.xp, 0)

  // Calculate XP by day
  const xpByDay: Record<string, number> = {}
  for (const log of logs) {
    const day = formatDate(new Date(log.date))
    xpByDay[day] = (xpByDay[day] || 0) + log.xp
  }

  return NextResponse.json({
    plan: plan
      ? { ...plan, rows: plan.rows.map(row => ({ ...row, lastEntry: buildLastEntry(row) })) }
      : null,
    logs,
    weeklyXP,
    xpByDay,
    weekStart: formatDate(monday),
    weekEnd: formatDate(sunday),
    today: formatDate(now),
    sessionDays: streakInfo.sessionDays,
    sessionGoal: streakInfo.effectiveGoal,
    streak: streakInfo.streak,
    bestStreak: streakInfo.bestStreak,
    lastWorkoutDaysAgo: streakInfo.lastWorkoutDaysAgo,
    comebackMode: streakInfo.comebackMode
  })
}

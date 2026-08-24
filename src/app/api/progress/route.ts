import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMonday, formatDate, normalizeWorkoutType } from '@/lib/types'
import { computeStreakInfo } from '@/lib/streaks'

export async function GET() {
  const now = new Date()
  const currentMonday = getMonday(now)

  // The 8 week-start Mondays (oldest first).
  const weekStarts: string[] = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(currentMonday)
    d.setDate(d.getDate() - i * 7)
    weekStarts.push(formatDate(d))
  }

  // One query covering the whole 8-week range; bucket by week in JS.
  const rangeStart = new Date(weekStarts[0] + 'T00:00:00')
  const rangeEnd = new Date(currentMonday)
  rangeEnd.setDate(rangeEnd.getDate() + 6)
  rangeEnd.setHours(23, 59, 59, 999)

  // Daily XP for the last 60 days (enough for 28-day rolling average with buffer)
  const sixtyDaysAgo = new Date(now)
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 59)
  sixtyDaysAgo.setHours(0, 0, 0, 0)

  const [weekLogs, dailyLogs, allDateRows] = await Promise.all([
    prisma.logEntry.findMany({
      where: {
        date: {
          gte: rangeStart,
          lte: rangeEnd
        }
      },
      select: {
        date: true,
        xp: true,
        type: true
      }
    }),
    prisma.logEntry.findMany({
      where: {
        date: {
          gte: sixtyDaysAgo,
          lte: now
        }
      },
      select: {
        date: true,
        xp: true
      }
    }),
    // Slim all-time date list: feeds computeStreakInfo and totalSessions.
    prisma.logEntry.findMany({
      select: { date: true }
    })
  ])

  // Bucket the 8-week logs by their week's Monday.
  const buckets = new Map<string, { xp: number; byType: Record<string, number>; days: Set<string> }>()
  for (const ws of weekStarts) {
    buckets.set(ws, { xp: 0, byType: {}, days: new Set() })
  }
  for (const log of weekLogs) {
    const ws = formatDate(getMonday(log.date))
    const bucket = buckets.get(ws)
    if (!bucket) continue
    bucket.xp += log.xp
    // Canonicalize legacy free-text types ('Gym A') so pre- and post-update
    // logs land in the same bucket; unknown types keep their raw key.
    const type = (normalizeWorkoutType(log.type) ?? log.type).toLowerCase()
    bucket.byType[type] = (bucket.byType[type] || 0) + log.xp
    bucket.days.add(formatDate(log.date))
  }

  const weeks = weekStarts.map(ws => {
    const bucket = buckets.get(ws)!
    return {
      weekStart: ws,
      xp: bucket.xp,
      byType: bucket.byType,
      sessions: bucket.days.size
    }
  })

  // Streaks + total distinct session days (all-time).
  const streakInfo = computeStreakInfo(allDateRows.map(row => row.date), now)
  const totalSessions = new Set(allDateRows.map(row => formatDate(row.date))).size

  // Aggregate XP by date
  const xpByDate: Record<string, number> = {}
  for (const log of dailyLogs) {
    const dateStr = formatDate(log.date)
    xpByDate[dateStr] = (xpByDate[dateStr] || 0) + log.xp
  }

  // Build array of daily XP for last 60 days
  const dailyXP: { date: string; xp: number }[] = []
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = formatDate(d)
    dailyXP.push({
      date: dateStr,
      xp: xpByDate[dateStr] || 0
    })
  }

  return NextResponse.json({
    weeks,
    dailyXP,
    streak: streakInfo.streak,
    bestStreak: streakInfo.bestStreak,
    totalSessions
  })
}

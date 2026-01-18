import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMonday, formatDate } from '@/lib/types'

export async function GET() {
  const now = new Date()
  const monday = getMonday(now)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  // Get current week's plan with logs
  const plan = await prisma.weekPlan.findFirst({
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
  })

  // Get all logs for the week (including unlinked ones)
  const logs = await prisma.logEntry.findMany({
    where: {
      date: {
        gte: monday,
        lte: sunday
      }
    },
    orderBy: { date: 'desc' }
  })

  // Calculate weekly XP
  const weeklyXP = logs.reduce((sum, log) => sum + log.xp, 0)

  // Calculate XP by day
  const xpByDay: Record<string, number> = {}
  for (const log of logs) {
    const day = formatDate(new Date(log.date))
    xpByDay[day] = (xpByDay[day] || 0) + log.xp
  }

  return NextResponse.json({
    plan,
    logs,
    weeklyXP,
    xpByDay,
    weekStart: formatDate(monday),
    weekEnd: formatDate(sunday),
    today: formatDate(now)
  })
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMonday, formatDate } from '@/lib/types'

export async function GET() {
  const now = new Date()

  // Get last 8 weeks of data
  const weeks: { weekStart: string; xp: number; byType: Record<string, number> }[] = []

  for (let i = 0; i < 8; i++) {
    const weekOffset = new Date(now)
    weekOffset.setDate(weekOffset.getDate() - i * 7)
    const monday = getMonday(weekOffset)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)

    const logs = await prisma.logEntry.findMany({
      where: {
        date: {
          gte: monday,
          lte: sunday
        }
      }
    })

    const totalXP = logs.reduce((sum, log) => sum + log.xp, 0)
    const byType: Record<string, number> = {}

    for (const log of logs) {
      const type = log.type.toLowerCase()
      byType[type] = (byType[type] || 0) + log.xp
    }

    weeks.unshift({
      weekStart: formatDate(monday),
      xp: totalXP,
      byType
    })
  }

  return NextResponse.json({ weeks })
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { formatDate } from '@/lib/types'

export async function GET() {
  // Get all logs with their linked plan rows
  const logs = await prisma.logEntry.findMany({
    orderBy: { date: 'desc' },
    include: {
      linkedPlanRow: {
        select: {
          exercise: true,
          setsText: true,
          repsTimeText: true,
          day: true,
          type: true,
          notes: true,
        }
      }
    }
  })

  // Build CSV content
  const headers = [
    'Date',
    'Day',
    'Type',
    'Exercise',
    'Planned Sets',
    'Planned Reps/Time',
    'Actual Sets',
    'Actual Reps',
    'Weight (kg)',
    'Km',
    'Circuits',
    'XP',
    'Notes',
    'Plan Notes'
  ]

  const rows = logs.map(log => {
    const plan = log.linkedPlanRow
    const date = new Date(log.date)
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })

    return [
      formatDate(date), // LOCAL yyyy-mm-dd, matching the app's local-day bucketing
      plan?.day || dayName,
      log.type,
      log.exerciseOrActivity,
      plan?.setsText || '',
      plan?.repsTimeText || '',
      log.setsCompleted?.toString() || '',
      log.reps?.toString() || '',
      log.weight?.toString() || '',
      log.km?.toString() || '',
      log.circuitsCompleted?.toString() || '',
      log.xp.toString(),
      log.notes || '',
      plan?.notes || ''
    ].map(cell => {
      // Escape CSV cells that contain commas, quotes, or newlines
      const str = String(cell)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }).join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="workout-logs-${formatDate(new Date())}.csv"`
    }
  })
}

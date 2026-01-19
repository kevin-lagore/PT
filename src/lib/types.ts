export type WorkoutType = 'Gym' | 'Run' | 'Circuit' | 'Activity'

export interface PlanRowWithLogs {
  id: string
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
  sortOrder: number
  logEntries: {
    id: string
    date: string
    setsCompleted: number | null
    reps: number | null
    weight: number | null
    km: number | null
    circuitsCompleted: number | null
    xp: number
  }[]
}

export interface WeekPlanWithRows {
  id: string
  weekStartDate: string
  rows: PlanRowWithLogs[]
}

export function calculateXP(type: string, data: {
  setsCompleted?: number
  km?: number
  circuitsCompleted?: number
  manualXP?: number
}): number {
  const normalizedType = type.toLowerCase()

  if (normalizedType === 'gym') {
    // Default to 1 set if not specified, 1 XP per set
    return data.setsCompleted !== undefined && data.setsCompleted > 0 ? data.setsCompleted : 1
  }

  if (normalizedType === 'run' && data.km) {
    return Math.round(data.km * 3) // 3 XP per km
  }

  if (normalizedType === 'circuit' && data.circuitsCompleted) {
    return data.circuitsCompleted * 15 // 15 XP per circuit
  }

  if (normalizedType === 'activity' && data.manualXP !== undefined) {
    return data.manualXP
  }

  return 0
}

export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[date.getDay()]
}

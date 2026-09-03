export type WorkoutType = 'Gym' | 'Run' | 'Circuit' | 'Activity'

// Normalizes a free-text workout type to a canonical WorkoutType.
// Precedence ORDER MATTERS (matched against the lowercased input):
//   1. startsWith 'gym'      -> 'Gym'
//   2. startsWith 'run'      -> 'Run'      (checked BEFORE circuit so 'Running circuit' resolves to 'Run')
//   3. includes 'circuit'    -> 'Circuit'
//   4. startsWith 'activity' -> 'Activity'
//   5. anything else         -> null
export function normalizeWorkoutType(raw: string): WorkoutType | null {
  const t = raw.trim().toLowerCase()
  if (t.startsWith('gym')) return 'Gym'
  if (t.startsWith('run')) return 'Run'
  if (t.includes('circuit')) return 'Circuit'
  if (t.startsWith('activity')) return 'Activity'
  return null
}

// Canonical key for matching the same exercise across weeks:
// trim, lowercase, collapse internal whitespace to single spaces.
export function normalizeExerciseName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Epley estimated one-rep max.
export function epley1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

// Seconds-per-km -> 'M:SS/km' (e.g. 385 -> '6:25/km'). Seconds are rounded
// first so 384.6 -> 6:25, and a round-up to a full minute carries (359.7 ->
// '6:00/km').
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`
}

// The most recent prior session for a plan row's exercise.
export interface LastEntry {
  date: string                                            // local yyyy-mm-dd of that most-recent session
  daysAgo: number
  sets: { reps: number | null; weight: number | null }[]  // gym: that session's sets in logged order; empty for runs
  km: number | null                                       // run: last logged distance, else null
  durationMin: number | null                              // run: last logged moving time (minutes), else null
  paceSecPerKm: number | null                             // run: durationMin*60/km — only when both km and duration exist
}

export interface PRInfo {
  kind: 'weight' | 'e1rm' | 'distance'
  value: number
  previous: number
  exercise: string
}

export interface ToastMessage {
  kind: 'xp' | 'pr' | 'error' | 'action'
  xp?: number          // 'xp' and 'pr'
  message?: string     // 'pr', 'error', 'action'
  actionLabel?: string // 'action' (e.g. 'Undo')
}

export interface PlanRowWithLogs {
  id: string
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
  sortOrder: number
  lastEntry?: LastEntry | null
  logEntries: {
    id: string
    date: string
    setsCompleted: number | null
    reps: number | null
    weight: number | null
    km: number | null
    durationMin: number | null
    circuitsCompleted: number | null
    xp: number
  }[]
}

export interface WeekPlanWithRows {
  id: string
  weekStartDate: string
  rows: PlanRowWithLogs[]
}

// Shape of GET /api/logs?week=... (the home screen's single fetch).
export interface WeekApiResponse {
  plan: { id: string; weekStartDate: string; rows: PlanRowWithLogs[] } | null
  logs: unknown[]
  weeklyXP: number
  xpByDay: Record<string, number>
  weekStart: string
  weekEnd: string
  today: string
  sessionDays: string[]        // this week's distinct local dates with >=1 log
  sessionGoal: number          // effective goal for this week (2/3/4, comeback ramp)
  streak: number
  bestStreak: number
  lastWorkoutDaysAgo: number | null
  comebackMode: boolean
}

export function calculateXP(type: string, data: {
  setsCompleted?: number
  km?: number
  circuitsCompleted?: number
  manualXP?: number
}): number {
  const typeLower = type.toLowerCase()

  if (typeLower.startsWith('gym')) {
    // Default to 1 set if not specified, 1 XP per set
    return data.setsCompleted !== undefined && data.setsCompleted > 0 ? data.setsCompleted : 1
  }

  if (typeLower.startsWith('run') && data.km) {
    return Math.round(data.km * 3) // 3 XP per km
  }

  if (typeLower.includes('circuit') && data.circuitsCompleted) {
    return data.circuitsCompleted * 15 // 15 XP per circuit
  }

  if (typeLower.startsWith('activity') && data.manualXP !== undefined) {
    return data.manualXP
  }

  return 0
}

// DO NOT MODIFY getMonday: existing WeekPlan.weekStartDate rows are matched by
// exact equality against its output.
// Load-bearing date-construction rule: when turning a yyyy-mm-dd string back
// into a Date, ALWAYS use new Date(ymd + 'T00:00:00') (local midnight).
// NEVER new Date('yyyy-mm-dd') — that parses as UTC midnight and lands on the
// previous local day in timezones ahead of UTC.
export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// LOCAL calendar date as yyyy-mm-dd. Never toISOString(): that converts to UTC
// and can shift the result across midnight for non-UTC timezones.
export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[date.getDay()]
}

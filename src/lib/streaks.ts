// Pure streak / weekly-goal logic. No prisma imports — only ./types helpers.
//
// SEMANTICS:
// - A session day = a distinct LOCAL calendar date (via formatDate) with >= 1 log.
//   Weekend logs count toward weekly totals; weekends are just never required.
// - Weeks start Monday (getMonday).
// - Effective goal per week is WEEKLY_GOAL (4) normally. Comeback ramp: after a
//   gap of >= COMEBACK_GAP_DAYS days with zero logs, the first week containing a
//   session has goal 2, the next calendar week goal 3, thereafter 4. The very
//   first session ever also starts a ramp. No logs ever -> comebackMode true, goal 2.
// - comebackMode for the CURRENT week: true iff the current week's effective goal < 4.
// - streak = consecutive weeks meeting their effective goal, counting backward
//   from the most recent COMPLETED week; the current in-progress week EXTENDS the
//   streak if it already meets its goal, but NEVER breaks it while in progress.
// - bestStreak = max streak anywhere in history (including the current one).
// - lastWorkoutDaysAgo = whole days between the most recent log's local date and
//   today (0 = today), null if no logs.

import { formatDate, getMonday } from './types'

export const WEEKLY_GOAL = 4
export const COMEBACK_GAP_DAYS = 14

export interface StreakResult {
  streak: number
  bestStreak: number
  effectiveGoal: number
  comebackMode: boolean
  lastWorkoutDaysAgo: number | null
  sessionDays: string[]
}

// Local midnight — NEVER new Date('yyyy-mm-dd'), which parses as UTC midnight.
function parseLocalDate(ymd: string): Date {
  return new Date(ymd + 'T00:00:00')
}

// Whole calendar days from a to b (both local midnights; rounding absorbs DST).
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseLocalDate(ymd)
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

function weekStartOf(ymd: string): string {
  return formatDate(getMonday(parseLocalDate(ymd)))
}

export function computeStreakInfo(allLogDates: Date[], now?: Date): StreakResult {
  const today = now ?? new Date()
  const todayYmd = formatDate(today)
  const currentWeekStart = formatDate(getMonday(today))

  // Distinct local session days, ascending.
  const allSessionDays = [...new Set(allLogDates.map(d => formatDate(d)))].sort()

  // sessionDays exposed in the result = the CURRENT week's session days.
  const sessionDays = allSessionDays.filter(d => weekStartOf(d) === currentWeekStart)

  if (allSessionDays.length === 0) {
    // No logs ever: prospective comeback ramp — first week back will have goal 2.
    return {
      streak: 0,
      bestStreak: 0,
      effectiveGoal: 2,
      comebackMode: true,
      lastWorkoutDaysAgo: null,
      sessionDays: [],
    }
  }

  const lastSessionDay = allSessionDays[allSessionDays.length - 1]
  const lastWorkoutDaysAgo = diffDays(parseLocalDate(lastSessionDay), parseLocalDate(todayYmd))

  // Comeback start weeks: the week of the first session ever, and the week of any
  // session whose previous session day is >= COMEBACK_GAP_DAYS days earlier.
  // (A start week's first session IS the comeback session: a >= 14-day gap can
  // never end inside a week that already had a session.)
  const comebackStartWeeks = new Set<string>()
  let prevDay: string | null = null
  for (const day of allSessionDays) {
    if (prevDay === null || diffDays(parseLocalDate(prevDay), parseLocalDate(day)) >= COMEBACK_GAP_DAYS) {
      comebackStartWeeks.add(weekStartOf(day))
    }
    prevDay = day
  }

  // Ramp is anchored to calendar weeks: goal 2 in the start week, 3 the very next
  // calendar week (whether or not it has sessions), 4 thereafter.
  const goalForWeek = (weekStartYmd: string): number => {
    if (comebackStartWeeks.has(weekStartYmd)) return 2
    if (comebackStartWeeks.has(addDaysYmd(weekStartYmd, -7))) return 3
    return WEEKLY_GOAL
  }

  // Sessions per week.
  const sessionsPerWeek = new Map<string, number>()
  for (const day of allSessionDays) {
    const ws = weekStartOf(day)
    sessionsPerWeek.set(ws, (sessionsPerWeek.get(ws) ?? 0) + 1)
  }

  // Walk every week from the first session's week through the last COMPLETED week,
  // tracking the running met-goal streak and the best run seen anywhere.
  let run = 0
  let bestStreak = 0
  for (let ws = weekStartOf(allSessionDays[0]); ws < currentWeekStart; ws = addDaysYmd(ws, 7)) {
    const met = (sessionsPerWeek.get(ws) ?? 0) >= goalForWeek(ws)
    run = met ? run + 1 : 0
    if (run > bestStreak) bestStreak = run
  }

  // Current streak = trailing run of completed weeks; the in-progress week extends
  // it if it already meets its goal, and never breaks it otherwise.
  let streak = run
  if ((sessionsPerWeek.get(currentWeekStart) ?? 0) >= goalForWeek(currentWeekStart)) {
    streak += 1
  }
  if (streak > bestStreak) bestStreak = streak

  // Effective goal for the CURRENT week. If this week has no session yet but the
  // gap since the last workout has already reached the comeback threshold, the
  // next session would start a ramp here — so the goal is prospectively 2.
  let effectiveGoal: number
  if (sessionDays.length === 0 && lastWorkoutDaysAgo >= COMEBACK_GAP_DAYS) {
    effectiveGoal = 2
  } else {
    effectiveGoal = goalForWeek(currentWeekStart)
  }

  return {
    streak,
    bestStreak,
    effectiveGoal,
    comebackMode: effectiveGoal < WEEKLY_GOAL,
    lastWorkoutDaysAgo,
    sessionDays,
  }
}

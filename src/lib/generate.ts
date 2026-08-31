// Pure next-week generation logic. No prisma imports — only ./types helpers.
// The route (/api/plans/generate) fetches the data and stays thin; everything
// here is deterministic on its inputs.
//
// PIPELINE (generateWeekRows):
//   source rows (last saved plan, or rows reconstructed from recent logs)
//     -> per-Gym-row weight progression from the exercise's last logged session
//     -> gym setsText '2' -> '3' bump after a >= 3-session source week
//     -> +5 min nudge on the week's LAST Run row if the source week had a run
//
// Day labels copy from the source untouched: they are SLOTS, not calendar
// promises — progression is per-exercise by name regardless of which actual
// day the logs landed on.

import { DAYS, formatDate, getDayOfWeek, normalizeExerciseName, normalizeWorkoutType } from './types'

// The plan-row shape shared with POST /api/plans { rows } (which validates and
// canonicalizes on save — generation itself never persists anything).
export interface GenRow {
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
}

// Slim LogEntry shape the generator needs (the route selects exactly this).
export interface GenLog {
  date: Date
  type: string
  exerciseOrActivity: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  createdAt: Date
}

// Logs inside the source plan's calendar week (empty when the source structure
// was reconstructed from logs) — they drive the sets bump and the run nudge.
export type SourceWeekLog = Pick<GenLog, 'date' | 'type'>

export interface GenerateResult {
  rows: GenRow[]
  notes: string[] // human strings for basedOn.notes (the route prepends the source line)
}

export interface RepRange {
  min: number
  max: number
}

// Big compound lifts progress in 5kg jumps, everything else 2.5kg.
const BIG_LIFT_RE = /squat|deadlift|rdl|leg press|lunge/i

const RUN_CAP_MINUTES = 40
const RUN_NUDGE_MINUTES = 5

// '5-8' -> {5,8}; '8' -> {8,8}; anything else ('30 sec', 'AMRAP', '') -> null.
export function parseRepRange(repsTimeText: string): RepRange | null {
  const match = repsTimeText.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!match) return null
  const min = parseInt(match[1], 10)
  const max = match[2] !== undefined ? parseInt(match[2], 10) : min
  return { min, max }
}

// '35 min' -> '40 min'; '30-35 min' -> '35-40 min' (the upper bound is nudged
// +5 toward the 40-min cap and the lower bound shifts with it, keeping the
// range width). Already at/past the cap, or unparseable -> unchanged.
export function nudgeRunTime(repsTimeText: string): string {
  const text = repsTimeText.trim()

  const range = text.match(/^(\d+)\s*-\s*(\d+)(\s*min.*)$/i)
  if (range) {
    const low = parseInt(range[1], 10)
    const high = parseInt(range[2], 10)
    if (high >= RUN_CAP_MINUTES) return repsTimeText
    const delta = Math.min(high + RUN_NUDGE_MINUTES, RUN_CAP_MINUTES) - high
    return `${low + delta}-${high + delta}${range[3]}`
  }

  const single = text.match(/^(\d+)(\s*min.*)$/i)
  if (single) {
    const minutes = parseInt(single[1], 10)
    if (minutes >= RUN_CAP_MINUTES) return repsTimeText
    return `${Math.min(minutes + RUN_NUDGE_MINUTES, RUN_CAP_MINUTES)}${single[2]}`
  }

  return repsTimeText
}

// The most recent session for one exercise.
export interface LastSession {
  dateYmd: string // local yyyy-mm-dd of the session
  // Expanded sets in createdAt order: an entry logged with setsCompleted > 1
  // counts as that many identical sets (mirrors /api/week's LastEntry).
  sets: { reps: number | null; weight: number | null }[]
  finalEntry: GenLog // last entry of the session in createdAt order
}

// Bucket logs by normalized exercise name and keep only each exercise's most
// recent session = all of its entries on its most recent LOCAL date (formatDate).
export function bucketLastSessions(logs: GenLog[]): Map<string, LastSession> {
  const byName = new Map<string, GenLog[]>()
  const sorted = [...logs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const log of sorted) {
    const key = normalizeExerciseName(log.exerciseOrActivity)
    const bucket = byName.get(key)
    if (bucket) bucket.push(log)
    else byName.set(key, [log])
  }

  const result = new Map<string, LastSession>()
  for (const [key, entries] of byName) {
    let lastDate = ''
    for (const entry of entries) {
      const d = formatDate(entry.date)
      if (d > lastDate) lastDate = d
    }

    const session = entries.filter(entry => formatDate(entry.date) === lastDate)
    const sets: { reps: number | null; weight: number | null }[] = []
    for (const entry of session) {
      const count = entry.setsCompleted != null && entry.setsCompleted > 1 ? entry.setsCompleted : 1
      for (let i = 0; i < count; i++) {
        sets.push({ reps: entry.reps, weight: entry.weight })
      }
    }

    result.set(key, { dateYmd: lastDate, sets, finalEntry: session[session.length - 1] })
  }
  return result
}

// No prior plan on record: reconstruct a bare source structure from recent
// logs — one row per distinct exercise, placed on the weekday its most recent
// log landed on, sized from that last session.
export function reconstructRowsFromLogs(logs: GenLog[]): GenRow[] {
  const sessions = bucketLastSessions(logs)

  const ordered: { row: GenRow; dayIndex: number; loggedAt: number }[] = []
  for (const session of sessions.values()) {
    const last = session.finalEntry
    const day = getDayOfWeek(new Date(last.date))

    let repsTimeText = ''
    if (last.reps != null) repsTimeText = String(last.reps)
    else if (last.km != null) repsTimeText = `${last.km} km`

    ordered.push({
      row: {
        day,
        type: normalizeWorkoutType(last.type) ?? last.type,
        notes: '',
        exercise: last.exerciseOrActivity,
        setsText: String(session.sets.length),
        repsTimeText
      },
      dayIndex: DAYS.indexOf(day),
      loggedAt: last.createdAt.getTime()
    })
  }

  ordered.sort((a, b) => a.dayIndex - b.dayIndex || a.loggedAt - b.loggedAt)
  return ordered.map(entry => entry.row)
}

// Generate next week's rows from a source structure plus logged history.
//   sourceRows     — the most recent prior plan's rows (or reconstructRowsFromLogs output)
//   historyLogs    — logs from the 90 days before the target Monday
//   sourceWeekLogs — logs inside the source plan's week ([] when reconstructed)
export function generateWeekRows(
  sourceRows: GenRow[],
  historyLogs: GenLog[],
  sourceWeekLogs: SourceWeekLog[]
): GenerateResult {
  const notes: string[] = []
  const lastSessions = bucketLastSessions(historyLogs)

  const sessionDayCount = new Set(sourceWeekLogs.map(log => formatDate(log.date))).size
  const bumpSets = sessionDayCount >= 3
  const ranInSourceWeek = sourceWeekLogs.some(log => normalizeWorkoutType(log.type) === 'Run')

  let bumped = false
  const rows = sourceRows.map(source => {
    // Canonicalize legacy free-text types where possible ('Gym A' -> 'Gym'),
    // but never drop an odd legacy row — keep it verbatim (as /api/plans copy does).
    const type = normalizeWorkoutType(source.type) ?? source.type
    const row: GenRow = {
      day: source.day,
      type,
      notes: source.notes,
      exercise: source.exercise,
      setsText: source.setsText,
      repsTimeText: source.repsTimeText
    }

    if (type !== 'Gym') return row

    // Weight progression: suggest more weight only when the last session was
    // complete (>= the planned set count), fully weighted, and EVERY set hit
    // the top of the rep range. Otherwise the source notes stay verbatim —
    // the Last: hints in the UI cover the rest.
    const range = parseRepRange(source.repsTimeText)
    const last = lastSessions.get(normalizeExerciseName(source.exercise))
    if (range && last && last.sets.length > 0) {
      const targetSets = parseInt(source.setsText, 10) || last.sets.length
      const complete =
        last.sets.length >= targetSets &&
        last.sets.every(set => set.weight != null && set.reps != null && set.reps >= range.max)

      if (complete) {
        const maxWeight = Math.max(...last.sets.map(set => set.weight as number))
        const increment = BIG_LIFT_RE.test(source.exercise) ? 5 : 2.5
        const suggested = Math.round((maxWeight + increment) * 2) / 2 // nearest 0.5
        row.notes = `Try ${suggested}kg`
        const rangeText = range.min === range.max ? `${range.max} reps` : `the top of ${range.min}-${range.max}`
        notes.push(`${source.exercise}: all sets hit ${rangeText} at ${maxWeight}kg -> try ${suggested}kg`)
      }
    }

    // Volume bump after a >= 3-session source week: '2' -> '3', never beyond.
    if (bumpSets && row.setsText.trim() === '2') {
      row.setsText = '3'
      bumped = true
    }

    return row
  })

  if (bumped) {
    notes.push(`Upgraded to 3 sets after a ${sessionDayCount}-session week`)
  }

  // Run progression: the source week included a run, so the week's LAST run
  // row gets its minutes pushed +5 toward the 40-min cap.
  if (ranInSourceWeek) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (normalizeWorkoutType(rows[i].type) !== 'Run') continue
      const nudged = nudgeRunTime(rows[i].repsTimeText)
      if (nudged !== rows[i].repsTimeText) {
        notes.push(`${rows[i].exercise}: ${rows[i].repsTimeText.trim()} -> ${nudged} after last week's run`)
        rows[i].repsTimeText = nudged
      }
      break
    }
  }

  return { rows, notes }
}

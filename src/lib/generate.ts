// Pure next-week generation logic. No prisma imports — only ./types helpers
// and the static ./exercise-catalog. The route (/api/plans/generate) fetches
// the data and stays thin; everything here is DETERMINISTIC on its inputs (no
// randomness, no Date.now) — regenerating the same target week from the same
// saved data yields identical output.
//
// PIPELINE (generateWeekRows):
//   source rows (last saved plan, or rows reconstructed from recent logs)
//     -> movement-pattern rotation on catalog-classified Gym rows: the main
//        lift (first Gym row of each day) advances only after a finished
//        3-week block; accessories advance every week. Skipped entirely on
//        the reconstruction path (recentPlanRows is empty there).
//     -> per-Gym-row weight progression from the exercise's last logged
//        session; a classified exercise with NO history gets a ratio-linked
//        starting-weight estimate (or a find-a-weight fallback note) instead
//     -> gym setsText '2' -> '3' bump after a >= 3-session source week
//     -> +5 min nudge on the week's LAST Run row if the source week had a
//        run; once that run already sits at the 40-min cap the nudge is a
//        no-op, so the run flavor alternates tempo <-> long easy instead
//
// Day labels copy from the source untouched: they are SLOTS, not calendar
// promises — progression is per-exercise by name regardless of which actual
// day the logs landed on.

import { DAYS, formatDate, formatPace, getDayOfWeek, normalizeExerciseName, normalizeWorkoutType } from './types'
import type { CatalogEntry, MovementPattern } from './exercise-catalog'
import { POOLS, VPUSH_FROM_HPUSH_RATIO, findCatalogEntry, nextRotationEntry } from './exercise-catalog'

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
// durationMin/stravaData feed the run-quality guidance and may be absent on
// old rows — everything degrades gracefully when they are null.
export interface GenLog {
  date: Date
  type: string
  exerciseOrActivity: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  durationMin: number | null
  stravaData: string | null
  createdAt: Date
}

// Logs inside the source plan's calendar week (empty when the source structure
// was reconstructed from logs) — they drive the sets bump and the run nudge.
export type SourceWeekLog = Pick<GenLog, 'date' | 'type'>

// Extra context for rotation + determinism.
export interface GenerateContext {
  // The target week's Monday as yyyy-mm-dd. Anchors the run-quality guidance's
  // 28-day window, and keeps generation a pure function of explicit inputs —
  // never the wall clock.
  targetWeekStartYmd: string
  // Rows of up to the last 3 SAVED plans, NEWEST first, source plan included.
  // Empty on the reconstruction path (no saved plan), which disables rotation
  // entirely and leaves that path's output untouched.
  recentPlanRows: GenRow[][]
}

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

// Run-quality guidance: paced runs (km + durationMin) from the 28 days before
// the target Monday. Drift above +8% = faded late; within +/-5% = even pacing.
const RUN_QUALITY_WINDOW_DAYS = 28
const PACE_DRIFT_FADE_PCT = 8
const PACE_DRIFT_EVEN_PCT = 5
// Above this split-pace CV the run was interval-like (run/walk breaks, reps):
// drift is dominated by the work/rest structure, so fade commentary is noise.
const PACE_CV_INTERVAL_THRESHOLD = 0.10

// Ratio estimates start deliberately light: 90% of the ratio-implied weight,
// rounded to the nearest 2.5kg jump; anything under one 2.5kg step is treated
// as "no estimate".
const ESTIMATE_SAFETY_FACTOR = 0.9
const MIN_ESTIMATE_KG = 2.5

export function roundTo2p5(weight: number): number {
  return Math.round(weight / 2.5) * 2.5
}

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

// Fail-soft extraction of paceDriftPct from a LogEntry.stravaData JSON blob:
// missing, unparseable, or non-numeric -> null.
export function parsePaceDriftPct(stravaData: string | null): number | null {
  if (!stravaData) return null
  try {
    const parsed: unknown = JSON.parse(stravaData)
    if (typeof parsed !== 'object' || parsed === null) return null
    const drift = (parsed as { paceDriftPct?: unknown }).paceDriftPct
    return typeof drift === 'number' && Number.isFinite(drift) ? drift : null
  } catch {
    return null
  }
}

// Fail-soft extraction of paceCV (same contract as parsePaceDriftPct).
export function parsePaceCV(stravaData: string | null): number | null {
  if (!stravaData) return null
  try {
    const parsed: unknown = JSON.parse(stravaData)
    if (typeof parsed !== 'object' || parsed === null) return null
    const cv = (parsed as { paceCV?: unknown }).paceCV
    return typeof cv === 'number' && Number.isFinite(cv) ? cv : null
  } catch {
    return null
  }
}

// True when a run row's minutes already sit at/over the 40-min cap (i.e. the
// +5 nudge is a no-op). Non-minute text ('5 km', 'AMRAP') -> false.
export function runAtCap(repsTimeText: string): boolean {
  const text = repsTimeText.trim()
  const range = text.match(/^(\d+)\s*-\s*(\d+)\s*min/i)
  if (range) return parseInt(range[2], 10) >= RUN_CAP_MINUTES
  const single = text.match(/^(\d+)\s*min/i)
  if (single) return parseInt(single[1], 10) >= RUN_CAP_MINUTES
  return false
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

interface PatternRef {
  refWeight: number // implied weight of the pattern's ratio-1.0 reference exercise
  sourceName: string // catalog name of the sibling the reference came from
  dateYmd: string // that sibling's session date (used only to pick the newest)
}

// Best in-pool reference weight for a pattern: among ratio-linked pool entries
// WITH logged history, take the one with the MOST RECENT session (ties resolve
// to pool order — deterministic) and divide its session max weight by its
// ratio. perHand logged weights are already per-hand and perHand ratios are
// defined against per-hand numbers, so there is no doubling anywhere.
function patternRefWeight(
  pattern: MovementPattern,
  lastSessions: Map<string, LastSession>,
  excludeNormalizedName: string | null
): PatternRef | null {
  let best: PatternRef | null = null
  for (const entry of POOLS[pattern]) {
    if (entry.ratio == null) continue
    const key = normalizeExerciseName(entry.name)
    if (excludeNormalizedName !== null && key === excludeNormalizedName) continue
    const session = lastSessions.get(key)
    if (!session) continue

    let maxWeight = 0
    for (const set of session.sets) {
      if (set.weight != null && set.weight > maxWeight) maxWeight = set.weight
    }
    if (maxWeight <= 0) continue

    if (!best || session.dateYmd > best.dateYmd) {
      best = { refWeight: maxWeight / entry.ratio, sourceName: entry.name, dateYmd: session.dateYmd }
    }
  }
  return best
}

// Starting-weight estimate for a history-less catalog exercise from a
// ratio-linked pattern sibling; vpush additionally anchors off the hpush
// reference (Overhead Press ~= 0.62 x Bench Press) when the whole vpush pool
// has no history. null when the exercise is bodyweight (ratio null), no
// sibling/anchor exists, or the estimate rounds below one 2.5kg step.
export function estimateStartingWeight(
  entry: CatalogEntry,
  lastSessions: Map<string, LastSession>
): { weight: number; sourceName: string } | null {
  if (entry.ratio == null) return null

  let ref = patternRefWeight(entry.pattern, lastSessions, normalizeExerciseName(entry.name))
  if (!ref && entry.pattern === 'vpush') {
    const hpushRef = patternRefWeight('hpush', lastSessions, null)
    if (hpushRef) {
      ref = {
        refWeight: hpushRef.refWeight * VPUSH_FROM_HPUSH_RATIO,
        sourceName: hpushRef.sourceName,
        dateYmd: hpushRef.dateYmd
      }
    }
  }
  if (!ref) return null

  const estimate = roundTo2p5(ESTIMATE_SAFETY_FACTOR * ref.refWeight * entry.ratio)
  if (estimate < MIN_ESTIMATE_KG) return null
  return { weight: estimate, sourceName: ref.sourceName }
}

// Generate next week's rows from a source structure plus logged history.
//   sourceRows     — the most recent prior plan's rows (or reconstructRowsFromLogs output)
//   historyLogs    — logs from the 90 days before the target Monday
//   sourceWeekLogs — logs inside the source plan's week ([] when reconstructed)
//   context        — target week + up to the last 3 saved plans' rows (newest
//                    first, source included) driving the rotation rules
export function generateWeekRows(
  sourceRows: GenRow[],
  historyLogs: GenLog[],
  sourceWeekLogs: SourceWeekLog[],
  context: GenerateContext
): GenerateResult {
  const notes: string[] = []
  const lastSessions = bucketLastSessions(historyLogs)

  const sessionDayCount = new Set(sourceWeekLogs.map(log => formatDate(log.date))).size
  const bumpSets = sessionDayCount >= 3
  const ranInSourceWeek = sourceWeekLogs.some(log => normalizeWorkoutType(log.type) === 'Run')

  // Rotation only applies when generating from saved plans; the reconstruction
  // path passes recentPlanRows: [] and stays rotation-free.
  const rotationEnabled = context.recentPlanRows.length > 0

  // Normalized exercise names per recent plan (newest first) for the
  // finished-3-week-block check on main lifts.
  const recentNameSets = context.recentPlanRows
    .slice(0, 3)
    .map(planRows => new Set(planRows.map(row => normalizeExerciseName(row.exercise))))

  // Main lift = the FIRST Gym-type row of each day slot.
  const mainLiftIndexes = new Set<number>()
  const daysWithMainLift = new Set<string>()
  sourceRows.forEach((source, index) => {
    const type = normalizeWorkoutType(source.type) ?? source.type
    if (type !== 'Gym' || daysWithMainLift.has(source.day)) return
    daysWithMainLift.add(source.day)
    mainLiftIndexes.add(index)
  })

  let bumped = false
  const rows = sourceRows.map((source, index) => {
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

    // ROTATION (classified Gym rows only). Main lifts hold for a 3-week
    // block: they advance only when the same exercise appears in ALL of the
    // last 3 saved plans. Accessories advance every week. Rotated rows keep
    // the slot's setsText and adopt the incoming exercise's default reps.
    const sourceEntry = findCatalogEntry(source.exercise)
    let active: CatalogEntry | null = sourceEntry
    let rotationNote: string | null = null

    if (rotationEnabled && sourceEntry) {
      const isMainLift = mainLiftIndexes.has(index)
      const key = normalizeExerciseName(source.exercise)
      const rotate = isMainLift
        ? recentNameSets.length >= 3 && recentNameSets.every(set => set.has(key))
        : true

      if (rotate) {
        const next = nextRotationEntry(sourceEntry)
        if (next.name !== sourceEntry.name) {
          row.exercise = next.name
          row.repsTimeText = next.defaultReps
          row.notes = '' // the source notes described the outgoing exercise
          active = next
          rotationNote = isMainLift
            ? `${next.name} replaces ${source.exercise} (3-week block complete)`
            : `Rotated in ${next.name} (weekly accessory rotation)`
        }
      }
    }

    // WEIGHT. Direct history in the window -> the existing progression:
    // suggest more weight only when the last session was complete (>= the
    // planned set count), fully weighted, and EVERY set hit the top of the
    // rep range; otherwise the notes stay as they are — the Last: hints in
    // the UI cover the rest. A weighted classified exercise with NO history
    // gets a ratio estimate (or the find-a-weight fallback note) instead.
    const range = parseRepRange(row.repsTimeText)
    const last = lastSessions.get(normalizeExerciseName(row.exercise))
    let tryNote: string | null = null
    let estimatePhrase: string | null = null

    if (last && last.sets.length > 0) {
      if (range) {
        const targetSets = parseInt(row.setsText, 10) || last.sets.length
        const complete =
          last.sets.length >= targetSets &&
          last.sets.every(set => set.weight != null && set.reps != null && set.reps >= range.max)

        if (complete) {
          const maxWeight = Math.max(...last.sets.map(set => set.weight as number))
          const increment = BIG_LIFT_RE.test(row.exercise) ? 5 : 2.5
          const suggested = Math.round((maxWeight + increment) * 2) / 2 // nearest 0.5
          row.notes = `Try ${suggested}kg`
          const rangeText = range.min === range.max ? `${range.max} reps` : `the top of ${range.min}-${range.max}`
          tryNote = `${row.exercise}: all sets hit ${rangeText} at ${maxWeight}kg -> try ${suggested}kg`
        }
      }
    } else if (active && active.ratio != null) {
      const estimate = estimateStartingWeight(active, lastSessions)
      if (estimate) {
        row.notes = `Start ~${estimate.weight}kg (est. from ${estimate.sourceName})`
        estimatePhrase = `start ~${estimate.weight}kg (est. from ${estimate.sourceName})`
      } else {
        row.notes = 'Find a comfortable weight - leave 2-3 reps in reserve'
      }
    }
    // (classified bodyweight exercises — ratio null — get no weight note)

    if (rotationNote) {
      notes.push(estimatePhrase ? `${rotationNote} - ${estimatePhrase}` : rotationNote)
    } else if (estimatePhrase) {
      notes.push(`${row.exercise}: no recent history - ${estimatePhrase}`)
    }
    if (tryNote) notes.push(tryNote)

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
  // row gets its minutes pushed +5 toward the 40-min cap. Once the row is
  // ALREADY at the cap the nudge is a no-op, so the run flavor alternates
  // deterministically instead: a tempo week hands over to a long easy run
  // and vice versa (keyed off the source row's exercise/notes text).
  if (ranInSourceWeek) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (normalizeWorkoutType(rows[i].type) !== 'Run') continue
      const current = rows[i].repsTimeText
      const nudged = nudgeRunTime(current)
      if (nudged !== current) {
        notes.push(`${rows[i].exercise}: ${current.trim()} -> ${nudged} after last week's run`)
        rows[i].repsTimeText = nudged
      } else if (runAtCap(current)) {
        const previous = rows[i].exercise
        const wasTempo = /tempo/i.test(rows[i].exercise) || /tempo/i.test(rows[i].notes)
        if (wasTempo) {
          rows[i].exercise = 'Longer Easy Run'
          rows[i].repsTimeText = '40 min'
          rows[i].notes = 'Easy pace all the way - enjoy it'
        } else {
          rows[i].exercise = 'Tempo Run'
          rows[i].repsTimeText = '35-40 min'
          rows[i].notes = '10 min easy, 3 x 5 min comfortably hard w/ 2 min jogs, 5 min easy'
        }
        notes.push(`${previous} is at the ${RUN_CAP_MINUTES}-min cap -> alternating to ${rows[i].exercise}`)
      }
      break
    }
  }

  // RUN-QUALITY GUIDANCE. Deterministic: the 28-day window hangs off the
  // target Monday (never the wall clock), and 'most recent' resolves by local
  // date with createdAt as the tiebreak. Only fires when next week actually
  // has a run row AND the window holds at least one paced run (km +
  // durationMin). stravaData is optional and fail-soft: without a parseable
  // paceDriftPct the pace note still lands, just without drift commentary.
  const hasRunRow = rows.some(row => normalizeWorkoutType(row.type) === 'Run')
  if (hasRunRow) {
    const windowStart = new Date(context.targetWeekStartYmd + 'T00:00:00')
    windowStart.setDate(windowStart.getDate() - RUN_QUALITY_WINDOW_DAYS)

    let latest: GenLog | null = null
    for (const log of historyLogs) {
      if (normalizeWorkoutType(log.type) !== 'Run') continue
      if (log.km == null || log.km <= 0) continue
      if (log.durationMin == null || log.durationMin <= 0) continue
      if (log.date < windowStart) continue
      if (
        !latest ||
        formatDate(log.date) > formatDate(latest.date) ||
        (formatDate(log.date) === formatDate(latest.date) &&
          log.createdAt.getTime() > latest.createdAt.getTime())
      ) {
        latest = log
      }
    }

    if (latest) {
      const km = latest.km as number
      const durationMin = latest.durationMin as number
      const paceSecPerKm = (durationMin * 60) / km
      const drift = parsePaceDriftPct(latest.stravaData)
      const cv = parsePaceCV(latest.stravaData)
      // Interval-like sessions (run/walk breaks, reps) have structurally spiky
      // split paces — drift/evenness commentary would be judging the rest
      // breaks, not the running. Pace itself is still worth reporting.
      const continuous = cv == null || cv <= PACE_CV_INTERVAL_THRESHOLD

      let paceNote = `Runs: last ${km} km at ${formatPace(paceSecPerKm)}`
      if (continuous && drift != null && drift > PACE_DRIFT_FADE_PCT) {
        paceNote += ` - you faded ${Math.round(drift)}% late, start slower`
        for (const row of rows) {
          if (normalizeWorkoutType(row.type) !== 'Run') continue
          row.notes = row.notes
            ? `${row.notes} - Start slower than you feel you should`
            : 'Start slower than you feel you should'
        }
      }
      notes.push(paceNote)

      if (continuous && drift != null && drift >= -PACE_DRIFT_EVEN_PCT && drift <= PACE_DRIFT_EVEN_PCT) {
        notes.push('Your last run was evenly paced - keep that up')
      }
    }
  }

  return { rows, notes }
}

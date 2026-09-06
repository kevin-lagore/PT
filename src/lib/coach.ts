// Coach brief: a short, blunt personal-trainer readout of the last three
// weeks, cached in Setting and served by /api/coach.
//
// Two generators produce the same CoachBrief shape:
//   - aiBrief: Claude structured-output call (only when ANTHROPIC_API_KEY is
//     set). ANY failure (timeout, refusal, bad parse) returns null so the
//     route falls back to computedBrief — an AI error must never surface.
//   - computedBrief: deterministic, always available.
//
// Setting keys:
//   'coach_brief'             — JSON-serialized CoachBrief
//   'coach_brief_fingerprint' — buildCoachFingerprint output at generation time
// Fingerprint: localToday | total log count | newest log id | plan id | plan
// row count — GET /api/coach recomputes it and reports stale when it moved
// (day rolled, logs added/removed, plan created/edited).

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { prisma } from './db'
import {
  DAYS,
  WorkoutType,
  formatDate,
  formatPace,
  getDayOfWeek,
  getMonday,
  normalizeExerciseName,
  normalizeWorkoutType,
} from './types'
import { StreakResult, WEEKLY_GOAL, computeStreakInfo } from './streaks'
import { parsePaceCV, parsePaceDriftPct, parseRepRange } from './generate'

// ---------------------------------------------------------------------------
// Shared contract
// ---------------------------------------------------------------------------

export interface CoachBrief {
  headline: string // one blunt line, the state of play
  lines: { topic: 'action' | 'strength' | 'running' | 'consistency'; text: string }[] // 2-5 short lines
  focus: string // THE one thing to work on now
  generatedAt: string // ISO
  method: 'ai' | 'computed'
}

// ---------------------------------------------------------------------------
// Gathered data shapes (pure inputs for the digest + computed fallback)
// ---------------------------------------------------------------------------

const DIGEST_WINDOW_DAYS = 21
// Mirror generate.ts's run-quality thresholds (not exported there).
const INTERVAL_PACE_CV = 0.1 // above this the run was interval/run-walk style
const FADE_DRIFT_PCT = 8 // drift beyond +8% on a continuous run = faded late
// Big lower-body lifts jump 5kg, everything else 2.5kg (mirrors generate.ts).
const BIG_LIFT_RE = /squat|deadlift|rdl|leg press|lunge/i

export interface CoachSessionItem {
  type: WorkoutType | null // normalized; null for unknown legacy types
  name: string
  sets: { reps: number | null; weight: number | null }[] // gym only (setsCompleted expanded)
  km: number | null // run only
  durationMin: number | null
  paceSecPerKm: number | null
  paceCV: number | null // from stravaData, fail-soft
  paceDriftPct: number | null
  xp: number
}

export interface CoachSession {
  dateYmd: string
  weekday: string
  items: CoachSessionItem[]
}

// Trend for a gym lift appearing in >= 2 sessions inside the window.
export interface LiftTrend {
  exercise: string
  sessionCount: number
  prevBestKg: number | null // best set weight of the second-most-recent session
  latestBestKg: number | null
  latestDateYmd: string
  repRangeText: string | null // this week's plan row reps text, when the lift is planned
  readyToProgress: boolean // latest session hit the plan's top-of-rep-range on all sets
  nextKg: number | null // suggested next weight when readyToProgress
}

export interface CoachPlanRow {
  day: string
  type: string
  exercise: string
  setsText: string
  repsTimeText: string
  logged: boolean // has >= 1 log entry inside the current week
}

export interface CoachData {
  todayYmd: string
  todayName: string
  weekStartYmd: string
  plan: { id: string; rows: CoachPlanRow[] } | null
  sessions: CoachSession[] // last 21 days, ascending by local date
  trends: LiftTrend[]
  streak: StreakResult
  priorWeeks: { weekStartYmd: string; sessionDays: number }[] // 2 full weeks, newest first
  // All-time bests recorded BEFORE the digest window ('pre-break reference'):
  // lets the brief place today's numbers against where the user used to be.
  historicBests: { exercise: string; bestKg: number | null; bestKm: number | null; dateYmd: string }[]
  // Gym sets / tonnage (sum reps x kg) / run km per week, current week first.
  weeklyVolume: { weekStartYmd: string; gymSets: number; tonnageKg: number; runKm: number }[]
  fingerprint: string
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

export interface CoachFingerprintParts {
  todayYmd: string
  logCount: number
  newestLogId: string | null
  planId: string | null
  planRowCount: number
}

// Pure join so GET (computeCoachFingerprint) and POST (gatherCoachData) can
// never drift apart on formatting.
export function buildCoachFingerprint(parts: CoachFingerprintParts): string {
  return [
    parts.todayYmd,
    String(parts.logCount),
    parts.newestLogId ?? 'none',
    parts.planId ?? 'none',
    String(parts.planRowCount),
  ].join('|')
}

// The GET route's cheap staleness probe — no digest work, three slim queries.
export async function computeCoachFingerprint(now: Date = new Date()): Promise<string> {
  const monday = getMonday(now)
  const [logCount, newestLog, plan] = await Promise.all([
    prisma.logEntry.count(),
    prisma.logEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }),
    prisma.weekPlan.findFirst({
      where: { weekStartDate: monday },
      select: { id: true, _count: { select: { rows: true } } },
    }),
  ])
  return buildCoachFingerprint({
    todayYmd: formatDate(now),
    logCount,
    newestLogId: newestLog?.id ?? null,
    planId: plan?.id ?? null,
    planRowCount: plan?._count.rows ?? 0,
  })
}

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

// Slim LogEntry shape the digest needs (the query selects exactly this).
export interface WindowLog {
  date: Date
  type: string
  exerciseOrActivity: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  durationMin: number | null
  xp: number
  stravaData: string | null
  createdAt: Date
}

// Group window logs into sessions by LOCAL date, and within a session merge
// entries of the same exercise (a gym entry with setsCompleted > 1 expands to
// that many identical sets, mirroring /api/week's LastEntry).
// Exported for unit checks — no I/O.
export function buildSessions(logs: WindowLog[]): CoachSession[] {
  const byDate = new Map<string, WindowLog[]>()
  for (const log of logs) {
    const ymd = formatDate(log.date)
    const bucket = byDate.get(ymd)
    if (bucket) bucket.push(log)
    else byDate.set(ymd, [log])
  }

  return [...byDate.keys()].sort().map(dateYmd => {
    const entries = byDate.get(dateYmd) as WindowLog[]
    const items = new Map<string, CoachSessionItem>()
    for (const log of entries) {
      const type = normalizeWorkoutType(log.type)
      const key = `${type ?? log.type}|${normalizeExerciseName(log.exerciseOrActivity)}`
      let item = items.get(key)
      if (!item) {
        item = {
          type,
          name: log.exerciseOrActivity,
          sets: [],
          km: null,
          durationMin: null,
          paceSecPerKm: null,
          paceCV: null,
          paceDriftPct: null,
          xp: 0,
        }
        items.set(key, item)
      }
      item.xp += log.xp
      if (type === 'Gym') {
        const count = log.setsCompleted != null && log.setsCompleted > 1 ? log.setsCompleted : 1
        for (let i = 0; i < count; i++) {
          item.sets.push({ reps: log.reps, weight: log.weight })
        }
      }
      if (type === 'Run' && log.km != null) {
        item.km = log.km
        item.durationMin = log.durationMin
        item.paceCV = parsePaceCV(log.stravaData)
        item.paceDriftPct = parsePaceDriftPct(log.stravaData)
        item.paceSecPerKm =
          log.km > 0 && log.durationMin != null && log.durationMin > 0
            ? Math.round((log.durationMin * 60) / log.km)
            : null
      }
    }
    return {
      dateYmd,
      weekday: getDayOfWeek(new Date(dateYmd + 'T00:00:00')),
      items: [...items.values()],
    }
  })
}

function bestSetWeight(sets: { reps: number | null; weight: number | null }[]): number | null {
  let max: number | null = null
  for (const set of sets) {
    if (set.weight != null && (max == null || set.weight > max)) max = set.weight
  }
  return max
}

// Trends for gym lifts appearing in >= 2 sessions in the window. The
// ready-to-progress check mirrors generate.ts: full planned set count, every
// set weighted, every set at the top of the plan row's rep range — and it
// fails soft (no plan row / unparseable range -> just no flag).
// Exported for unit checks — no I/O.
export function buildTrends(sessions: CoachSession[], plan: { rows: CoachPlanRow[] } | null): LiftTrend[] {
  const byName = new Map<string, { dateYmd: string; sets: CoachSessionItem['sets']; display: string }[]>()
  for (const session of sessions) {
    for (const item of session.items) {
      if (item.type !== 'Gym' || item.sets.length === 0) continue
      const key = normalizeExerciseName(item.name)
      const bucket = byName.get(key)
      const occurrence = { dateYmd: session.dateYmd, sets: item.sets, display: item.name }
      if (bucket) bucket.push(occurrence)
      else byName.set(key, [occurrence])
    }
  }

  const planGymRows = new Map<string, CoachPlanRow>()
  if (plan) {
    for (const row of plan.rows) {
      if (normalizeWorkoutType(row.type) !== 'Gym') continue
      const key = normalizeExerciseName(row.exercise)
      if (!planGymRows.has(key)) planGymRows.set(key, row)
    }
  }

  const trends: LiftTrend[] = []
  for (const [key, occurrences] of byName) {
    if (occurrences.length < 2) continue
    const latest = occurrences[occurrences.length - 1]
    const prev = occurrences[occurrences.length - 2]
    const latestBestKg = bestSetWeight(latest.sets)
    const prevBestKg = bestSetWeight(prev.sets)

    const planRow = planGymRows.get(key) ?? null
    const range = planRow ? parseRepRange(planRow.repsTimeText) : null
    let readyToProgress = false
    if (planRow && range) {
      const targetSets = parseInt(planRow.setsText, 10) || latest.sets.length
      readyToProgress =
        latest.sets.length >= targetSets &&
        latest.sets.every(set => set.weight != null && set.reps != null && set.reps >= range.max)
    }
    const nextKg =
      readyToProgress && latestBestKg != null
        ? Math.round((latestBestKg + (BIG_LIFT_RE.test(latest.display) ? 5 : 2.5)) * 2) / 2
        : null

    trends.push({
      exercise: latest.display,
      sessionCount: occurrences.length,
      prevBestKg,
      latestBestKg,
      latestDateYmd: latest.dateYmd,
      repRangeText: planRow ? planRow.repsTimeText : null,
      readyToProgress,
      nextKg,
    })
  }

  // Deterministic order: most recently trained first, then by name.
  trends.sort((a, b) =>
    a.latestDateYmd < b.latestDateYmd ? 1 : a.latestDateYmd > b.latestDateYmd ? -1 : a.exercise.localeCompare(b.exercise)
  )
  return trends
}

// One batched query set -> everything the digest, the computed fallback, and
// the fingerprint need.
export async function gatherCoachData(now: Date = new Date()): Promise<CoachData> {
  const todayYmd = formatDate(now)
  // Local midnight — never new Date('yyyy-mm-dd'), which parses as UTC midnight.
  const todayLocal = new Date(todayYmd + 'T00:00:00')
  const monday = getMonday(now)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  const windowStart = new Date(todayLocal)
  windowStart.setDate(windowStart.getDate() - DIGEST_WINDOW_DAYS)

  // ~1 year of log dates (slim select) for streak computation, like /api/week.
  const yearAgo = new Date(now)
  yearAgo.setDate(yearAgo.getDate() - 365)
  yearAgo.setHours(0, 0, 0, 0)

  const [windowLogs, streakDateRows, plan, logCount, newestLog, allTimeLogs] = await Promise.all([
    prisma.logEntry.findMany({
      where: { date: { gte: windowStart } },
      select: {
        date: true,
        type: true,
        exerciseOrActivity: true,
        setsCompleted: true,
        reps: true,
        weight: true,
        km: true,
        durationMin: true,
        xp: true,
        stravaData: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.logEntry.findMany({
      where: { date: { gte: yearAgo } },
      select: { date: true },
    }),
    prisma.weekPlan.findFirst({
      where: { weekStartDate: monday },
      include: {
        rows: {
          orderBy: { sortOrder: 'asc' },
          include: {
            logEntries: {
              where: { date: { gte: monday, lte: sunday } },
              select: { id: true },
            },
          },
        },
      },
    }),
    prisma.logEntry.count(),
    prisma.logEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }),
    // Everything BEFORE the digest window with a load or distance attached —
    // the pre-break reference the brief measures the comeback against.
    prisma.logEntry.findMany({
      where: {
        date: { lt: windowStart },
        OR: [{ weight: { not: null } }, { km: { not: null } }],
      },
      select: { date: true, exerciseOrActivity: true, weight: true, km: true },
    }),
  ])

  const streak = computeStreakInfo(streakDateRows.map(row => row.date), now)

  const planData = plan
    ? {
        id: plan.id,
        rows: plan.rows.map(row => ({
          day: row.day,
          type: row.type,
          exercise: row.exercise,
          setsText: row.setsText,
          repsTimeText: row.repsTimeText,
          logged: row.logEntries.length > 0,
        })),
      }
    : null

  const sessions = buildSessions(windowLogs)
  const trends = buildTrends(sessions, planData)

  // Prior 2 FULL calendar weeks (newest first): distinct session days each.
  const allDays = [...new Set(streakDateRows.map(row => formatDate(row.date)))]
  const priorWeeks = [7, 14].map(offset => {
    const start = new Date(monday)
    start.setDate(start.getDate() - offset)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const startYmd = formatDate(start)
    const endYmd = formatDate(end)
    return {
      weekStartYmd: startYmd,
      sessionDays: allDays.filter(day => day >= startYmd && day < endYmd).length,
    }
  })

  const fingerprint = buildCoachFingerprint({
    todayYmd,
    logCount,
    newestLogId: newestLog?.id ?? null,
    planId: plan?.id ?? null,
    planRowCount: plan?.rows.length ?? 0,
  })

  // Historic (pre-window) bests per exercise. Parenthetical suffixes are
  // stripped before grouping so legacy names like 'Back Squat (Barbell)'
  // collapse onto today's 'Back Squat'.
  const relaxedName = (name: string) => normalizeExerciseName(name.replace(/\(.*?\)/g, ' '))
  const bestsByName = new Map<string, { display: string; bestKg: number | null; bestKm: number | null; dateYmd: string }>()
  for (const log of allTimeLogs) {
    const key = relaxedName(log.exerciseOrActivity)
    if (!key) continue
    const existing = bestsByName.get(key)
    const kg = log.weight
    const km = log.km
    if (!existing) {
      bestsByName.set(key, {
        display: log.exerciseOrActivity.replace(/\(.*?\)/g, '').trim(),
        bestKg: kg,
        bestKm: km,
        dateYmd: formatDate(log.date),
      })
      continue
    }
    if (kg != null && (existing.bestKg == null || kg > existing.bestKg)) {
      existing.bestKg = kg
      existing.dateYmd = formatDate(log.date)
    }
    if (km != null && (existing.bestKm == null || km > existing.bestKm)) existing.bestKm = km
  }
  const historicBests = [...bestsByName.values()]
    .filter(best => (best.bestKg != null && best.bestKg > 1) || best.bestKm != null)
    .sort((a, b) => (b.bestKg ?? 0) - (a.bestKg ?? 0))
    .map(best => ({ exercise: best.display, bestKg: best.bestKg, bestKm: best.bestKm, dateYmd: best.dateYmd }))

  // Gym sets / tonnage / run km per week for the 3 weeks the window spans,
  // current week first. Sessions already expand setsCompleted > 1.
  const weekStartOfYmd = (ymd: string) => formatDate(getMonday(new Date(ymd + 'T00:00:00')))
  const volumeByWeek = new Map<string, { gymSets: number; tonnageKg: number; runKm: number }>()
  for (const session of sessions) {
    const ws = weekStartOfYmd(session.dateYmd)
    const bucket = volumeByWeek.get(ws) ?? { gymSets: 0, tonnageKg: 0, runKm: 0 }
    for (const item of session.items) {
      if (item.type === 'Gym') {
        bucket.gymSets += item.sets.length
        for (const set of item.sets) {
          if (set.reps != null && set.weight != null) bucket.tonnageKg += set.reps * set.weight
        }
      } else if (item.type === 'Run' && item.km != null) {
        bucket.runKm += item.km
      }
    }
    volumeByWeek.set(ws, bucket)
  }
  const weeklyVolume = [...volumeByWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekStartYmd, vol]) => ({
      weekStartYmd,
      gymSets: vol.gymSets,
      tonnageKg: Math.round(vol.tonnageKg),
      runKm: Math.round(vol.runKm * 10) / 10,
    }))

  return {
    todayYmd,
    todayName: getDayOfWeek(now),
    weekStartYmd: formatDate(monday),
    plan: planData,
    sessions,
    trends,
    streak,
    priorWeeks,
    historicBests,
    weeklyVolume,
    fingerprint,
  }
}

// ---------------------------------------------------------------------------
// Digest (pure — the AI prompt body)
// ---------------------------------------------------------------------------

function fmtKg(kg: number | null): string {
  return kg != null ? `${kg}kg` : 'n/a'
}

function formatSessionItem(item: CoachSessionItem): string {
  const label = `${item.name} [${item.type ?? 'Other'}]`
  if (item.type === 'Gym' && item.sets.length > 0) {
    const sets = item.sets
      .map(set => `${set.reps ?? '?'}x${set.weight != null ? `${set.weight}kg` : 'bw'}`)
      .join(', ')
    return `${label}: ${sets}`
  }
  if (item.type === 'Run' && item.km != null) {
    let text = `${label}: ${item.km} km`
    if (item.durationMin != null) text += ` in ${item.durationMin} min`
    if (item.paceSecPerKm != null) text += ` at ${formatPace(item.paceSecPerKm)}`
    if (item.paceCV != null) text += `, paceCV ${item.paceCV}`
    if (item.paceDriftPct != null) text += `, paceDrift ${item.paceDriftPct > 0 ? '+' : ''}${item.paceDriftPct}%`
    if (item.paceCV != null && item.paceCV > INTERVAL_PACE_CV) {
      text += ' (interval/run-walk session - uneven pacing is the point)'
    }
    return text
  }
  return `${label}: ${item.xp} XP`
}

// Unlogged (day, type) pairs in plan order — 'Thursday Gym, Friday Run'.
function remainingSummary(rows: CoachPlanRow[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const row of rows) {
    if (row.logged) continue
    const key = `${row.day} ${normalizeWorkoutType(row.type) ?? row.type}`
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(key)
  }
  return parts.join(', ')
}

// Compact plain-text digest of CoachData — everything the model may cite.
export function buildCoachDigest(data: CoachData): string {
  const out: string[] = []
  out.push(`Training digest - today is ${data.todayYmd} (${data.todayName}). Weights in kg, paces in min/km.`)
  out.push('')

  out.push(`## Sessions - last ${DIGEST_WINDOW_DAYS} days (oldest first)`)
  if (data.sessions.length === 0) out.push('No sessions logged in the window.')
  for (const session of data.sessions) {
    out.push(`${session.dateYmd} (${session.weekday}):`)
    for (const item of session.items) out.push(`  ${formatSessionItem(item)}`)
  }
  out.push('')

  out.push('## Gym lift trends (lifts logged 2+ times in the window)')
  if (data.trends.length === 0) out.push('No lift logged twice in the window.')
  for (const trend of data.trends) {
    let line =
      `${trend.exercise}: previous best set ${fmtKg(trend.prevBestKg)}, ` +
      `latest ${fmtKg(trend.latestBestKg)} (${trend.latestDateYmd}, ${trend.sessionCount} sessions)`
    if (trend.repRangeText) line += `, planned reps ${trend.repRangeText}`
    line +=
      trend.readyToProgress && trend.nextKg != null
        ? `. READY TO PROGRESS: all sets hit the top of the rep range - next weight ${trend.nextKg}kg.`
        : '.'
    out.push(line)
  }
  out.push('')

  if (data.historicBests.length > 0) {
    out.push('## Pre-break reference - all-time bests from BEFORE this training block')
    out.push('(Use these to place current numbers: how much of his old strength is back. Names may differ slightly from current exercises - connect them where obvious.)')
    for (const best of data.historicBests) {
      const bits: string[] = []
      if (best.bestKg != null) bits.push(`${best.bestKg}kg`)
      if (best.bestKm != null) bits.push(`${best.bestKm}km`)
      out.push(`${best.exercise}: ${bits.join(', ')} (${best.dateYmd})`)
    }
    out.push('')
  }

  if (data.weeklyVolume.length > 0) {
    out.push('## Weekly volume (current week first)')
    for (const vol of data.weeklyVolume) {
      out.push(
        `Week of ${vol.weekStartYmd}: ${vol.gymSets} gym sets, ${vol.tonnageKg}kg total tonnage, ${vol.runKm}km run.`
      )
    }
    out.push('')
  }

  const streak = data.streak
  out.push(`## This week (starts ${data.weekStartYmd})`)
  out.push(
    `Session days so far: ${streak.sessionDays.length} of goal ${streak.effectiveGoal}` +
      (streak.sessionDays.length > 0 ? ` (${streak.sessionDays.join(', ')})` : '') +
      '.'
  )
  out.push(
    `Streak: ${streak.streak} week(s), best ${streak.bestStreak}. Last workout: ` +
      (streak.lastWorkoutDaysAgo == null ? 'never' : `${streak.lastWorkoutDaysAgo} day(s) ago`) +
      '.'
  )
  if (streak.comebackMode) {
    out.push(
      `COMEBACK RAMP ACTIVE: goal is ${streak.effectiveGoal} this week. ` +
        'Weeks 1-2 back are meant to be light - do not push weight or volume.'
    )
  }
  if (data.plan && data.plan.rows.length > 0) {
    out.push('Plan rows (day | type | exercise | sets x reps/time | status):')
    for (const row of data.plan.rows) {
      out.push(
        `- ${row.day} | ${row.type} | ${row.exercise} | ${row.setsText} x ${row.repsTimeText} | ` +
          (row.logged ? 'LOGGED' : 'not logged yet')
      )
    }
    const left = remainingSummary(data.plan.rows)
    out.push(left ? `Left this week: ${left}.` : 'Everything planned this week is already logged.')
  } else {
    out.push('No plan saved for this week.')
  }
  out.push('')

  out.push(`## Prior 2 full weeks (target ${WEEKLY_GOAL} session days/week)`)
  for (const week of data.priorWeeks) {
    out.push(`Week of ${week.weekStartYmd}: ${week.sessionDays} of ${WEEKLY_GOAL} session days.`)
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Computed fallback (deterministic)
// ---------------------------------------------------------------------------

// Focus = the next unlogged planned session (today-or-later first, then missed
// earlier days), or 'Plan your week' when there is no plan.
function computeFocus(data: CoachData): string {
  if (!data.plan || data.plan.rows.length === 0) return 'Plan your week'

  const remaining = data.plan.rows.filter(row => !row.logged)
  if (remaining.length === 0) return 'All planned sessions are logged - recover, then plan next week.'

  const todayIdx = DAYS.indexOf(data.todayName)
  const rank = (day: string): number => {
    const idx = DAYS.indexOf(day)
    if (idx === -1 || todayIdx === -1) return 99
    return idx >= todayIdx ? idx - todayIdx : idx - todayIdx + 7
  }
  const next = [...remaining].sort((a, b) => rank(a.day) - rank(b.day))[0]
  const nextType = normalizeWorkoutType(next.type) ?? next.type
  const names = remaining
    .filter(row => row.day === next.day && (normalizeWorkoutType(row.type) ?? row.type) === nextType)
    .map(row => row.exercise)
  const nameText = names.length > 3 ? `${names.slice(0, 3).join(', ')}, ...` : names.join(', ')
  const dayPhrase = next.day === data.todayName ? 'today' : `on ${next.day}`
  return `Do the ${nextType} session ${dayPhrase}: ${nameText}.`
}

// Deterministic brief in the same terse voice the AI is prompted for. Always
// emits action + consistency; strength/running only when the window has data.
export function computedBrief(data: CoachData): CoachBrief {
  const streak = data.streak
  const done = streak.sessionDays.length
  const goal = streak.effectiveGoal
  const lines: CoachBrief['lines'] = []

  // action — what is left this week.
  if (data.plan && data.plan.rows.length > 0) {
    const left = remainingSummary(data.plan.rows)
    lines.push({
      topic: 'action',
      text: left
        ? `${done} of ${goal} sessions done; left: ${left}.`
        : `Every planned session is logged - ${done} of ${goal} days banked.`,
    })
  } else {
    lines.push({
      topic: 'action',
      text: `No plan saved this week; ${done} session${done === 1 ? '' : 's'} logged so far.`,
    })
  }

  // strength — progression first, then trend, then bare volume.
  const gymSessionCount = data.sessions.filter(session => session.items.some(item => item.type === 'Gym')).length
  const ready = data.trends.filter(trend => trend.readyToProgress && trend.nextKg != null && trend.latestBestKg != null)
  if (ready.length > 0) {
    const first = ready[0]
    const extra = ready.length > 1 ? ` ${ready.length - 1} more lift${ready.length > 2 ? 's are' : ' is'} ready too.` : ''
    lines.push({
      topic: 'strength',
      text: streak.comebackMode
        ? `${first.exercise} hit the top of the range at ${first.latestBestKg}kg - hold it through the ramp.`
        : `${first.exercise}: all sets at the top of the range at ${first.latestBestKg}kg - load ${first.nextKg}kg next.${extra}`,
    })
  } else if (data.trends.length > 0) {
    const trend = data.trends.find(t => t.prevBestKg != null && t.latestBestKg != null)
    if (trend && trend.prevBestKg != null && trend.latestBestKg != null) {
      lines.push({
        topic: 'strength',
        text:
          trend.latestBestKg > trend.prevBestKg
            ? `${trend.exercise} up ${trend.prevBestKg}kg -> ${trend.latestBestKg}kg over ${DIGEST_WINDOW_DAYS} days.`
            : trend.latestBestKg < trend.prevBestKg
              ? `${trend.exercise} down ${trend.prevBestKg}kg -> ${trend.latestBestKg}kg - check recovery.`
              : `${trend.exercise} flat at ${trend.latestBestKg}kg - chase the top of the rep range.`,
      })
    } else {
      lines.push({
        topic: 'strength',
        text: `${data.trends.length} lift${data.trends.length === 1 ? '' : 's'} repeated in ${DIGEST_WINDOW_DAYS} days but no weights logged - log the load.`,
      })
    }
  } else if (gymSessionCount > 0) {
    lines.push({
      topic: 'strength',
      text: `${gymSessionCount} gym session${gymSessionCount === 1 ? '' : 's'} in ${DIGEST_WINDOW_DAYS} days; no lift logged twice yet.`,
    })
  }

  // running — latest run; never criticize interval pacing.
  const runs: CoachSessionItem[] = []
  for (const session of data.sessions) {
    for (const item of session.items) {
      if (item.type === 'Run' && item.km != null) runs.push(item)
    }
  }
  if (runs.length > 0) {
    const last = runs[runs.length - 1]
    const paceText = last.paceSecPerKm != null ? ` at ${formatPace(last.paceSecPerKm)}` : ''
    const continuous = last.paceCV == null || last.paceCV <= INTERVAL_PACE_CV
    const faded = continuous && last.paceDriftPct != null && last.paceDriftPct > FADE_DRIFT_PCT
    lines.push({
      topic: 'running',
      text: faded
        ? `Last run ${last.km} km${paceText}, faded ${Math.round(last.paceDriftPct as number)}% late - start slower.`
        : `Last run ${last.km} km${paceText}; ${runs.length} run${runs.length === 1 ? '' : 's'} in ${DIGEST_WINDOW_DAYS} days.`,
    })
  }

  // consistency
  let consistency: string
  if (streak.lastWorkoutDaysAgo == null) {
    consistency = 'No history yet; the streak starts with your first logged week.'
  } else if (streak.comebackMode) {
    consistency = `Comeback ramp: this week's goal is ${goal}, not ${WEEKLY_GOAL} - light on purpose.`
  } else if (streak.lastWorkoutDaysAgo >= 7) {
    consistency = `${streak.lastWorkoutDaysAgo} days since your last workout; the ${streak.streak}-week streak is on the line.`
  } else {
    const [week1, week2] = data.priorWeeks
    consistency =
      `Streak ${streak.streak} week${streak.streak === 1 ? '' : 's'} (best ${streak.bestStreak}); ` +
      `last two full weeks ${week1?.sessionDays ?? 0}/${WEEKLY_GOAL} and ${week2?.sessionDays ?? 0}/${WEEKLY_GOAL}.`
  }
  lines.push({ topic: 'consistency', text: consistency })

  // headline
  let headline: string
  if (streak.lastWorkoutDaysAgo == null) headline = 'Blank slate - nothing logged yet.'
  else if (done >= goal) headline = `Week made: ${done} of ${goal} sessions banked.`
  else if (streak.lastWorkoutDaysAgo >= 7) headline = `Nothing logged in ${streak.lastWorkoutDaysAgo} days.`
  else headline = `${done} of ${goal} sessions in this week.`

  return {
    headline,
    lines: lines.slice(0, 5),
    focus: computeFocus(data),
    generatedAt: new Date().toISOString(),
    method: 'computed',
  }
}

// ---------------------------------------------------------------------------
// AI brief (only when ANTHROPIC_API_KEY is set)
// ---------------------------------------------------------------------------

const BriefSchema = z.object({
  headline: z.string(),
  lines: z
    .array(
      z.object({
        topic: z.enum(['action', 'strength', 'running', 'consistency']),
        text: z.string(),
      })
    )
    .min(2)
    .max(5),
  focus: z.string(),
})

const COACH_SYSTEM = [
  "You are the user's personal trainer of several years, writing his short daily brief from the training digest.",
  'He reads it every morning in ten seconds. It earns its place ONLY by telling him something he cannot see from glancing at his own log.',
  '',
  'What insight means here:',
  '- Compare across weeks and against the pre-break reference: "bench 55kg is 92% of your January 60" beats "bench went up".',
  '- Connect numbers to consequences: a 30%+ tonnage jump in a comeback week is an injury flag, name it as one.',
  '- Spot what he has not noticed: a day that keeps slipping, a lift that stalled while its twin moved, runs quietly getting faster.',
  '- Interpretation is mandatory: never state a fact without saying what it means or what to do about it.',
  '',
  'Example of the difference (do not copy the content, copy the altitude):',
  '  meh:  "Squat moved 60 to 65kg. Hold there."',
  '  good: "Squat 65kg two weeks in - 93% of your January best. The comeback is nearly priced in; do not rush the last 5kg."',
  '',
  'The sentence shape that earns its keep: named cause -> quantified effect vs HIS OWN baseline -> directive with a number.',
  'Each line does a different JOB - what changed, why it matters, what it costs or buys, what to do. Never five metrics in a row.',
  'Match the register to the day state (PR day, returning after a gap, ramp week, week already closed, quiet stretch). On a day with no real story, write two sharp lines - never manufacture insight to fill five.',
  '',
  'Hard rules:',
  '- Every claim cites a real number from the digest. No emojis. No hedging. Praise only what the data proves and only when it is rare enough to mean something.',
  '- Judge behaviour, never identity: "Thursday slipped twice" is coaching; "you are inconsistent" is not.',
  '- Never expose internal metric names (paceCV, paceDrift, e1RM, tonnage field names) - translate: "even splits", "faded late", "estimated max", "total weight moved".',
  '- Each line under 22 words. No two lines making the same point. No filler lines ("rest today", "week is done") unless they carry advice.',
  '- Vary the shape day to day - do not open every headline with the session count.',
  '- A dry, knowing edge is welcome; cheerleading is not.',
  '- If a lift is marked READY TO PROGRESS, name the precomputed next weight.',
  '- If the comeback ramp is active, weeks 1-2 back are SUPPOSED to be light: hold weights there, and frame restraint as the strategy.',
  '- Never criticize interval or run/walk sessions for uneven pacing - the variability is the workout.',
  "- Weekends are family time: NEVER prescribe weekend sessions or make-ups. A missed session is deleted, not owed. On Sat/Sun close the week honestly and point the focus at Monday.",
  '- lines: 2 to 5 entries, each tagged action, strength, running, or consistency. Cover topics that have data; skip ones with none.',
  '- headline: one line - the sharpest true thing about where his training stands.',
  '- focus: ONE imperative sentence, the single highest-leverage thing to do next - and it must carry its why ("Repeat Thursday\'s weights Monday - the 122% load jump needs absorbing").',
].join('\n')

const AI_TIMEOUT_MS = 20_000

// Claude-backed brief. Returns null on ANY failure — no key, timeout, refusal,
// unparseable output — so the route falls back to computedBrief silently.
export async function aiBrief(data: CoachData): Promise<CoachBrief | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  try {
    const client = new Anthropic() // reads ANTHROPIC_API_KEY
    const response = await client.messages.parse(
      {
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: { effort: 'high', format: zodOutputFormat(BriefSchema) },
        system: COACH_SYSTEM,
        messages: [{ role: 'user', content: buildCoachDigest(data) }],
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
    )

    if (response.stop_reason === 'refusal') return null
    const parsed = response.parsed_output
    if (!parsed || parsed.lines.length < 2) return null

    return {
      headline: parsed.headline,
      lines: parsed.lines.slice(0, 5),
      focus: parsed.focus,
      generatedAt: new Date().toISOString(),
      method: 'ai',
    }
  } catch {
    return null
  }
}

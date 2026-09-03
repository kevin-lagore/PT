import { prisma } from './db'
import { calculateXP, normalizeWorkoutType, formatDate, getMonday, getDayOfWeek } from './types'

// ---------------------------------------------------------------------------
// Strava ingest: OAuth token handling + activity sync into LogEntry.
// Setting keys: strava_refresh_token, strava_access_token,
// strava_expires_at (epoch seconds as string), strava_last_sync (ISO),
// strava_last_epoch (epoch seconds as string).
// ---------------------------------------------------------------------------

export interface TokenSet {
  access_token: string
  refresh_token: string
  expires_at: number // epoch seconds
}

export interface SyncResult {
  imported: { name: string; type: string; km: number | null; xp: number; date: string }[]
  skipped: number
  totalXP: number
  enriched: number // existing entries backfilled with stravaData this sync
}

// Slim shape of a Strava activity (only the fields we read).
interface StravaActivity {
  id: number
  name: string | null
  sport_type: string
  distance: number // meters
  moving_time: number // seconds
  start_date_local: string // wall time with a BOGUS trailing 'Z' — see parseStravaLocalDate
}

// One km split from the activity DETAIL endpoint's splits_metric.
export interface StravaSplit {
  distance: number // meters
  moving_time: number // seconds
}

// Slim shape of GET /api/v3/activities/{id} (only the fields we read).
interface StravaActivityDetail {
  moving_time: number // seconds
  average_heartrate?: number
  total_elevation_gain?: number // meters
  splits_metric?: StravaSplit[]
}

// Parsed shape of LogEntry.stravaData (all fields null/absent when unknown).
export interface RunAnalysis {
  avgPaceSecPerKm: number | null
  splitsSecPerKm: number[]
  paceCV: number
  paceDriftPct: number
}

const RUN_SPORT_TYPES = ['Run', 'TrailRun', 'VirtualRun']
const MIN_ACTIVITY_SECONDS = 900 // non-runs shorter than this are skipped
const OVERLAP_SECONDS = 7 * 86400 // re-fetch window to catch late uploads
const FIRST_SYNC_SECONDS = 90 * 86400

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit checks — no I/O).
// ---------------------------------------------------------------------------

// Strava's start_date_local looks like '2026-08-24T07:10:00Z' but the 'Z' is
// WRONG: the value IS the athlete's local wall time. Strip the 'Z' so the
// string parses as a LOCAL instant, matching how the rest of the app stores
// workout dates.
export function parseStravaLocalDate(startDateLocal: string): Date {
  return new Date(startDateLocal.replace(/Z$/, ''))
}

// Meters -> km rounded to 2 decimals.
export function metersToKm(distanceMeters: number): number {
  return Math.round(distanceMeters / 10) / 100
}

// Non-run activities: 1 XP per 3 moving minutes.
export function activityManualXP(movingTimeSeconds: number): number {
  return Math.round(movingTimeSeconds / 180)
}

// Dedupe tolerance for manually-logged runs: same local date and within 1 km.
export function isSameRunKm(existingKm: number | null, incomingKm: number): boolean {
  return existingKm != null && Math.abs(existingKm - incomingKm) <= 1
}

// Seconds -> minutes rounded to 1 decimal (e.g. 1930s -> 32.2).
export function secondsToMinutes1dp(seconds: number): number {
  return Math.round(seconds / 6) / 10
}

// Pace/consistency analysis for one run.
//   avgPaceSecPerKm — movingTimeSec / km (null when km is 0/unknown)
//   splitsSecPerKm  — per-split pace: moving_time / (distance/1000)
//   paceCV          — stddev/mean of split paces (0 when < 2 splits)
//   paceDriftPct    — (mean pace of the final third of splits - mean of the
//                     first third) / first third * 100; positive = fading.
//                     0 when < 3 splits (thirds are floor(n/3) splits each).
export function computeRunAnalysis(input: {
  movingTimeSec: number
  km: number
  splits: StravaSplit[]
}): RunAnalysis {
  const { movingTimeSec, km, splits } = input

  const avgPaceSecPerKm =
    Number.isFinite(km) && km > 0 && Number.isFinite(movingTimeSec)
      ? Math.round(movingTimeSec / km)
      : null

  // Unrounded per-split paces (sec/km); splits without distance are unusable.
  const paces = splits
    .filter(s => Number.isFinite(s.distance) && s.distance > 0 && Number.isFinite(s.moving_time))
    .map(s => s.moving_time / (s.distance / 1000))

  const splitsSecPerKm = paces.map(p => Math.round(p))

  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

  let paceCV = 0
  if (paces.length >= 2) {
    const m = mean(paces)
    if (m > 0) {
      const variance = mean(paces.map(p => (p - m) ** 2))
      paceCV = Math.round((Math.sqrt(variance) / m) * 1000) / 1000
    }
  }

  let paceDriftPct = 0
  if (paces.length >= 3) {
    const third = Math.floor(paces.length / 3)
    const firstMean = mean(paces.slice(0, third))
    const lastMean = mean(paces.slice(paces.length - third))
    if (firstMean > 0) {
      paceDriftPct = Math.round(((lastMean - firstMean) / firstMean) * 1000) / 10
    }
  }

  return { avgPaceSecPerKm, splitsSecPerKm, paceCV, paceDriftPct }
}

// Serialize a detail fetch into LogEntry.stravaData. Runs carry the full
// analysis (plus HR/elevation when Strava has them); everything else stores
// just the moving time.
export function buildStravaData(detail: StravaActivityDetail, isRun: boolean, km: number | null): string {
  if (!isRun) {
    return JSON.stringify({ movingTimeSec: detail.moving_time })
  }
  const analysis = computeRunAnalysis({
    movingTimeSec: detail.moving_time,
    km: km ?? 0,
    splits: detail.splits_metric ?? []
  })
  return JSON.stringify({
    movingTimeSec: detail.moving_time,
    avgPaceSecPerKm: analysis.avgPaceSecPerKm,
    splitsSecPerKm: analysis.splitsSecPerKm,
    paceCV: analysis.paceCV,
    paceDriftPct: analysis.paceDriftPct,
    avgHr: detail.average_heartrate ?? null,
    elevationM: detail.total_elevation_gain ?? null
  })
}

// ---------------------------------------------------------------------------
// Config + OAuth
// ---------------------------------------------------------------------------

export function isStravaConfigured(): boolean {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET)
}

// Public origin for OAuth redirects. Behind Vercel the request URL's origin
// can come through as http, so prefer the forwarded headers. Auth and callback
// MUST both use this (Strava requires the redirect_uri to match).
export function getPublicOrigin(request: { url: string; headers: Headers }): string {
  const proto = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('x-forwarded-host')
  if (proto && host) {
    return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`
  }
  return new URL(request.url).origin
}

export function buildAuthUrl(origin: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? '',
    redirect_uri: `${origin}/api/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all'
  })
  return `https://www.strava.com/oauth/authorize?${params.toString()}`
}

async function postTokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID ?? '',
      client_secret: process.env.STRAVA_CLIENT_SECRET ?? '',
      ...form
    })
  })
  if (!res.ok) {
    throw new Error(`Strava token request failed (${res.status})`)
  }
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at
  }
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  return postTokenRequest({ code, grant_type: 'authorization_code' })
}

// Persist a token set in Setting. Strava may ROTATE the refresh token on
// every refresh, so always store the returned one.
export async function storeTokens(tokens: TokenSet): Promise<void> {
  await setSetting('strava_refresh_token', tokens.refresh_token)
  await setSetting('strava_access_token', tokens.access_token)
  await setSetting('strava_expires_at', String(tokens.expires_at))
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  })
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

// Returns a valid access token, refreshing (and re-storing the possibly
// rotated refresh token) when the stored one is missing or expires within 5
// minutes. Throws if Strava was never connected.
async function getAccessToken(): Promise<string> {
  const refreshToken = await getSetting('strava_refresh_token')
  if (!refreshToken) {
    throw new Error('Strava is not connected')
  }

  const [accessToken, expiresAtStr] = await Promise.all([
    getSetting('strava_access_token'),
    getSetting('strava_expires_at')
  ])
  const expiresAt = expiresAtStr ? Number(expiresAtStr) : NaN
  const nowSec = Math.floor(Date.now() / 1000)

  if (accessToken && Number.isFinite(expiresAt) && expiresAt >= nowSec + 300) {
    return accessToken
  }

  const tokens = await postTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  await storeTokens(tokens)
  return tokens.access_token
}

async function fetchActivities(accessToken: string, afterEpoch: number): Promise<StravaActivity[]> {
  const activities: StravaActivity[] = []
  for (let page = 1; page <= 3; page++) {
    const url =
      'https://www.strava.com/api/v3/athlete/activities' +
      `?after=${afterEpoch}&per_page=100&page=${page}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) {
      throw new Error(`Strava activities fetch failed (${res.status})`)
    }
    const batch = (await res.json()) as StravaActivity[]
    activities.push(...batch)
    if (batch.length < 100) break
  }
  return activities
}

// Detail fetch for one activity (splits, HR, elevation). Returns null on ANY
// failure — enrichment is best-effort and must never fail a sync/import.
async function fetchActivityDetail(
  accessToken: string,
  activityId: string
): Promise<StravaActivityDetail | null> {
  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return null
    return (await res.json()) as StravaActivityDetail
  } catch {
    return null
  }
}

// Imports one activity. Returns the imported summary, or null when the
// activity is skipped (already imported, duplicate manual run, or a short
// non-run). durationMin comes from the summary's moving_time so it survives a
// failed detail fetch; stravaData is only stored when the detail fetch works.
async function importActivity(
  activity: StravaActivity,
  accessToken: string
): Promise<SyncResult['imported'][number] | null> {
  const stravaActivityId = String(activity.id)

  // Dedupe: already imported via Strava.
  const alreadyImported = await prisma.logEntry.findUnique({
    where: { stravaActivityId },
    select: { id: true }
  })
  if (alreadyImported) return null

  const localDate = parseStravaLocalDate(activity.start_date_local)
  const localDay = formatDate(localDate)
  const isRun = RUN_SPORT_TYPES.includes(activity.sport_type)

  const durationMin = secondsToMinutes1dp(activity.moving_time)

  if (!isRun) {
    // Non-run: only count sessions of 15+ moving minutes.
    if (activity.moving_time < MIN_ACTIVITY_SECONDS) return null
    const xp = calculateXP('Activity', { manualXP: activityManualXP(activity.moving_time) })
    const name = activity.name || activity.sport_type
    const detail = await fetchActivityDetail(accessToken, stravaActivityId)
    await prisma.logEntry.create({
      data: {
        date: localDate,
        type: 'Activity',
        exerciseOrActivity: name,
        km: null,
        durationMin,
        xp,
        stravaActivityId,
        stravaData: detail ? buildStravaData(detail, false, null) : null
      }
    })
    return { name, type: 'Activity', km: null, xp, date: localDay }
  }

  const km = metersToKm(activity.distance)

  // Dedupe: a manually-logged run (no stravaActivityId) on the same LOCAL
  // date within 1 km. [local midnight, next local midnight) captures exactly
  // the entries whose formatDate equals the activity's local date; the type
  // check is fuzzy so it happens in JS.
  const dayStart = new Date(localDay + 'T00:00:00')
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const sameDayManual = await prisma.logEntry.findMany({
    where: {
      stravaActivityId: null,
      date: { gte: dayStart, lt: dayEnd }
    },
    select: { type: true, km: true }
  })
  const duplicate = sameDayManual.some(
    log => normalizeWorkoutType(log.type) === 'Run' && isSameRunKm(log.km, km)
  )
  if (duplicate) return null

  // Plan linking: this week's plan, run rows only. Prefer the row for the
  // activity's day, else the first run row with no logs yet.
  const plan = await prisma.weekPlan.findFirst({
    where: { weekStartDate: getMonday(localDate) },
    include: {
      rows: {
        orderBy: { sortOrder: 'asc' },
        include: { logEntries: { select: { id: true } } }
      }
    }
  })
  let linkedPlanRowId: string | null = null
  let planExercise: string | null = null
  if (plan) {
    const runRows = plan.rows.filter(row => normalizeWorkoutType(row.type) === 'Run')
    const dayName = getDayOfWeek(localDate)
    const match =
      runRows.find(row => row.day === dayName) ??
      runRows.find(row => row.logEntries.length === 0) ??
      null
    if (match) {
      linkedPlanRowId = match.id
      planExercise = match.exercise
    }
  }

  const name = planExercise ?? (activity.name || activity.sport_type)
  const xp = calculateXP('Run', { km })
  const detail = await fetchActivityDetail(accessToken, stravaActivityId)
  await prisma.logEntry.create({
    data: {
      date: localDate,
      type: 'Run',
      exerciseOrActivity: name,
      km,
      durationMin,
      xp,
      stravaActivityId,
      linkedPlanRowId,
      stravaData: detail ? buildStravaData(detail, true, km) : null
    }
  })
  return { name, type: 'Run', km, xp, date: localDay }
}

// ENRICHMENT BACKFILL: upgrade up to `limit` already-imported entries that
// predate stravaData (or whose detail fetch failed) with a fresh detail
// fetch. Best-effort: a failed fetch just leaves the entry for a later sync.
async function backfillStravaData(accessToken: string, limit: number): Promise<number> {
  const pending = await prisma.logEntry.findMany({
    where: { stravaActivityId: { not: null }, stravaData: null },
    select: { id: true, type: true, km: true, stravaActivityId: true },
    orderBy: { date: 'desc' },
    take: limit
  })

  let enriched = 0
  for (const entry of pending) {
    if (!entry.stravaActivityId) continue
    const detail = await fetchActivityDetail(accessToken, entry.stravaActivityId)
    if (!detail) continue
    const isRun = normalizeWorkoutType(entry.type) === 'Run'
    try {
      await prisma.logEntry.update({
        where: { id: entry.id },
        data: {
          durationMin: secondsToMinutes1dp(detail.moving_time),
          stravaData: buildStravaData(detail, isRun, entry.km)
        }
      })
      enriched++
    } catch {
      // Never let one bad row abort the sync.
    }
  }
  return enriched
}

export async function syncStrava(): Promise<SyncResult> {
  const accessToken = await getAccessToken()

  const nowSec = Math.floor(Date.now() / 1000)
  const lastEpochStr = await getSetting('strava_last_epoch')
  const lastEpoch = lastEpochStr ? Number(lastEpochStr) : NaN
  // Overlap window on incremental syncs catches late uploads; first sync
  // pulls the trailing 90 days.
  const after = Number.isFinite(lastEpoch)
    ? lastEpoch - OVERLAP_SECONDS
    : nowSec - FIRST_SYNC_SECONDS

  const activities = await fetchActivities(accessToken, after)

  const imported: SyncResult['imported'] = []
  let skipped = 0
  for (const activity of activities) {
    // Never let one bad activity abort the sync.
    try {
      const result = await importActivity(activity, accessToken)
      if (result) imported.push(result)
      else skipped++
    } catch {
      skipped++
    }
  }

  // Backfill detail data onto entries imported before enrichment existed (or
  // whose detail fetch failed last time). 10 per sync keeps us well inside
  // Strava's rate limits.
  let enriched = 0
  try {
    enriched = await backfillStravaData(accessToken, 10)
  } catch {
    // Enrichment is best-effort; the sync result still stands.
  }

  await setSetting('strava_last_sync', new Date().toISOString())
  await setSetting('strava_last_epoch', String(nowSec))

  const totalXP = imported.reduce((sum, item) => sum + item.xp, 0)
  return { imported, skipped, totalXP, enriched }
}

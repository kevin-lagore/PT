import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  CoachBrief,
  aiBrief,
  computeBaseScore,
  computeCoachFingerprint,
  computedBrief,
  gatherCoachData,
} from '@/lib/coach'

export const dynamic = 'force-dynamic'
// Vercel: allow long Claude / Strava-detail calls (Hobby default is 10s)
export const maxDuration = 60

const BRIEF_KEY = 'coach_brief'
const FINGERPRINT_KEY = 'coach_brief_fingerprint'

// Fail-soft parse of the cached Setting value — a corrupt blob just reads as
// 'no brief yet' (stale: true) instead of erroring the home screen. Legacy
// cached briefs hold focus as a single string — normalized to [string] here so
// the client only ever sees the array shape.
function parseStoredBrief(value: string | null): CoachBrief | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Omit<CoachBrief, 'focus'> & { focus: unknown }
    if (typeof parsed?.headline !== 'string' || !Array.isArray(parsed.lines)) return null
    const focus =
      typeof parsed.focus === 'string'
        ? [parsed.focus]
        : Array.isArray(parsed.focus) && parsed.focus.every(item => typeof item === 'string')
          ? (parsed.focus as string[])
          : null
    if (!focus || focus.length === 0) return null
    return { ...parsed, focus }
  } catch {
    return null
  }
}

// GET /api/coach — the cached brief; NEVER generates. Base is computed FRESH
// on every GET (cheap slim queries), independent of the cached brief.
//   200 { brief: CoachBrief | null, stale: boolean, base: BaseScore }
// stale = no brief yet, the local day rolled, or training data changed since
// generation (fingerprint mismatch).
export async function GET() {
  const [fingerprint, stored, storedFingerprint, base] = await Promise.all([
    computeCoachFingerprint(),
    prisma.setting.findUnique({ where: { key: BRIEF_KEY } }),
    prisma.setting.findUnique({ where: { key: FINGERPRINT_KEY } }),
    computeBaseScore(),
  ])

  const brief = parseStoredBrief(stored?.value ?? null)
  const stale = brief === null || storedFingerprint?.value !== fingerprint
  return NextResponse.json({ brief, stale, base })
}

// POST /api/coach — regenerate now (AI when ANTHROPIC_API_KEY is set, else
// computed; any AI failure falls back to computed silently), store, return.
//   200 { brief: CoachBrief, base: BaseScore }
export async function POST() {
  const data = await gatherCoachData()
  const brief = (await aiBrief(data)) ?? computedBrief(data)

  const value = JSON.stringify(brief) // focus stored in the new array shape
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: BRIEF_KEY },
      update: { value },
      create: { key: BRIEF_KEY, value },
    }),
    prisma.setting.upsert({
      where: { key: FINGERPRINT_KEY },
      update: { value: data.fingerprint },
      create: { key: FINGERPRINT_KEY, value: data.fingerprint },
    }),
  ])

  return NextResponse.json({ brief, base: data.base })
}

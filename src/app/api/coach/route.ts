import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  CoachBrief,
  aiBrief,
  computeCoachFingerprint,
  computedBrief,
  gatherCoachData,
} from '@/lib/coach'

export const dynamic = 'force-dynamic'

const BRIEF_KEY = 'coach_brief'
const FINGERPRINT_KEY = 'coach_brief_fingerprint'

// Fail-soft parse of the cached Setting value — a corrupt blob just reads as
// 'no brief yet' (stale: true) instead of erroring the home screen.
function parseStoredBrief(value: string | null): CoachBrief | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as CoachBrief
    if (
      typeof parsed?.headline !== 'string' ||
      !Array.isArray(parsed.lines) ||
      typeof parsed.focus !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// GET /api/coach — the cached brief; NEVER generates.
//   200 { brief: CoachBrief | null, stale: boolean }
// stale = no brief yet, the local day rolled, or training data changed since
// generation (fingerprint mismatch).
export async function GET() {
  const [fingerprint, stored, storedFingerprint] = await Promise.all([
    computeCoachFingerprint(),
    prisma.setting.findUnique({ where: { key: BRIEF_KEY } }),
    prisma.setting.findUnique({ where: { key: FINGERPRINT_KEY } }),
  ])

  const brief = parseStoredBrief(stored?.value ?? null)
  const stale = brief === null || storedFingerprint?.value !== fingerprint
  return NextResponse.json({ brief, stale })
}

// POST /api/coach — regenerate now (AI when ANTHROPIC_API_KEY is set, else
// computed; any AI failure falls back to computed silently), store, return.
//   200 { brief: CoachBrief }
export async function POST() {
  const data = await gatherCoachData()
  const brief = (await aiBrief(data)) ?? computedBrief(data)

  const value = JSON.stringify(brief)
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

  return NextResponse.json({ brief })
}

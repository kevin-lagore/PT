// Static movement-pattern catalog powering week-to-week exercise rotation and
// starting-weight estimation in ./generate. Pure data + lookup helpers — no
// side effects, no persistence, fully deterministic.
//
// RATIO TABLE: the `ratio` numbers are conservative strength-ratio heuristics —
// rough population averages of how each lift compares to its pattern's
// reference exercise (the ratio-1.0 entry), deliberately kept on the low side.
// They only ever SEED a starting weight for an exercise with no logged
// history; the generator further multiplies by a 0.9 safety factor and rounds
// to a 2.5kg jump, so first sessions land comfortably light.

import { normalizeExerciseName } from './types'

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'hpush' // horizontal push
  | 'vpush' // vertical push
  | 'hpull' // horizontal pull
  | 'vpull' // vertical pull
  | 'lunge'
  | 'core'
  | 'carry'

export interface CatalogEntry {
  name: string
  pattern: MovementPattern
  // Strength ratio relative to the pattern's reference exercise (ratio 1.0).
  // null = bodyweight / never weight-estimated. perHand entries define their
  // ratio against PER-HAND numbers (one dumbbell vs the barbell weight), and
  // logged perHand weights are already per-hand — so estimates never double.
  ratio: number | null
  perHand?: boolean
  defaultReps: string
  // Alias entries exist so decorated template rows classify (e.g. the literal
  // plan row 'Lat Pulldown or Chin-Up'). They are never rotation TARGETS, and
  // rotating FROM one behaves like rotating from the canonical entry it names.
  aliasOf?: string
}

// Pool arrays are in ROTATION ORDER with the reference exercise first.
export const POOLS: Record<MovementPattern, CatalogEntry[]> = {
  squat: [
    { name: 'Back Squat', pattern: 'squat', ratio: 1.0, defaultReps: '5-8' },
    { name: 'Front Squat', pattern: 'squat', ratio: 0.85, defaultReps: '5-8' },
    { name: 'Goblet Squat', pattern: 'squat', ratio: 0.35, perHand: true, defaultReps: '8-12' },
    { name: 'Leg Press', pattern: 'squat', ratio: 1.8, defaultReps: '10-12' }
  ],
  hinge: [
    { name: 'Deadlift', pattern: 'hinge', ratio: 1.0, defaultReps: '5' },
    { name: 'Romanian Deadlift', pattern: 'hinge', ratio: 0.75, defaultReps: '5-8' },
    { name: 'Trap-Bar Deadlift', pattern: 'hinge', ratio: 1.05, defaultReps: '5-8' },
    { name: 'Good Morning', pattern: 'hinge', ratio: 0.45, defaultReps: '8-10' }
  ],
  hpush: [
    { name: 'Bench Press', pattern: 'hpush', ratio: 1.0, defaultReps: '5-8' },
    { name: 'Incline Bench Press', pattern: 'hpush', ratio: 0.8, defaultReps: '5-8' },
    { name: 'DB Bench Press', pattern: 'hpush', ratio: 0.4, perHand: true, defaultReps: '8-10' },
    { name: 'Incline DB Press', pattern: 'hpush', ratio: 0.35, perHand: true, defaultReps: '8-10' },
    { name: 'Push-Ups', pattern: 'hpush', ratio: null, defaultReps: '10-15' }
  ],
  vpush: [
    { name: 'Overhead Press', pattern: 'vpush', ratio: 1.0, defaultReps: '5-8' },
    { name: 'Seated DB Shoulder Press', pattern: 'vpush', ratio: 0.4, perHand: true, defaultReps: '8-10' },
    { name: 'Push Press', pattern: 'vpush', ratio: 1.15, defaultReps: '5' }
  ],
  hpull: [
    { name: 'Barbell Row', pattern: 'hpull', ratio: 1.0, defaultReps: '8-10' },
    { name: 'One-Arm Dumbbell Row', pattern: 'hpull', ratio: 0.45, perHand: true, defaultReps: '8-10' },
    { name: 'Chest-Supported Row', pattern: 'hpull', ratio: 0.9, defaultReps: '8-10' },
    { name: 'Seated Cable Row', pattern: 'hpull', ratio: 1.0, defaultReps: '8-12' }
  ],
  vpull: [
    { name: 'Lat Pulldown', pattern: 'vpull', ratio: 1.0, defaultReps: '8-10' },
    { name: 'Pull-Ups', pattern: 'vpull', ratio: null, defaultReps: '5-8' },
    { name: 'Chin-Ups', pattern: 'vpull', ratio: null, defaultReps: '5-8' },
    // Alias so the classic template row classifies; rotation from it advances
    // from Lat Pulldown, i.e. lands on Pull-Ups.
    { name: 'Lat Pulldown or Chin-Up', pattern: 'vpull', ratio: 1.0, defaultReps: '8', aliasOf: 'Lat Pulldown' }
  ],
  lunge: [
    { name: 'Walking Lunges', pattern: 'lunge', ratio: 1.0, perHand: true, defaultReps: '8-10 each side' },
    { name: 'DB Split Squat', pattern: 'lunge', ratio: 0.9, perHand: true, defaultReps: '8-10 each side' },
    { name: 'Reverse Lunges', pattern: 'lunge', ratio: 1.0, perHand: true, defaultReps: '8-10 each side' }
  ],
  core: [
    { name: 'Plank', pattern: 'core', ratio: null, defaultReps: '30-45 sec' },
    { name: 'Dead Bug', pattern: 'core', ratio: null, defaultReps: '10 each side' },
    { name: 'Hanging Knee Raises', pattern: 'core', ratio: null, defaultReps: '10-12' },
    { name: 'Pallof Press', pattern: 'core', ratio: null, defaultReps: '10 each side' }
  ],
  carry: [
    { name: 'Farmer Carry', pattern: 'carry', ratio: null, defaultReps: '30 m' },
    { name: 'Suitcase Carry', pattern: 'carry', ratio: null, defaultReps: '30 m each side' }
  ]
}

// Cross-pattern anchor: when NO vpush exercise has any history, the vpush
// reference (Overhead Press) is estimated as 0.62 x the hpush reference
// weight. This is the ONLY cross-pattern anchor.
export const VPUSH_FROM_HPUSH_RATIO = 0.62

// normalized name -> entry, in pool declaration order (deterministic).
const byNormalizedName = new Map<string, CatalogEntry>()
for (const pool of Object.values(POOLS)) {
  for (const entry of pool) {
    byNormalizedName.set(normalizeExerciseName(entry.name), entry)
  }
}

// Classify a plan-row exercise name against the catalog.
//   1. normalizeExerciseName equality (exact template names, any casing/spacing)
//   2. contains-fallback for decorated template rows, longest catalog name
//      wins (e.g. 'Plank (only if ahead of the clock)' -> Plank,
//      'Farmer Carry (only if ahead of the clock)' -> Farmer Carry)
// No match -> null: the row is never rotated and never weight-estimated.
export function findCatalogEntry(name: string): CatalogEntry | null {
  const normalized = normalizeExerciseName(name)
  const exact = byNormalizedName.get(normalized)
  if (exact) return exact

  let best: CatalogEntry | null = null
  let bestLength = 0
  for (const [key, entry] of byNormalizedName) {
    if (key.length > bestLength && normalized.includes(key)) {
      best = entry
      bestLength = key.length
    }
  }
  return best
}

// The next rotation TARGET after `entry` in its pool: advance one slot with
// wrap-around, skipping alias entries. Rotating FROM an alias starts at the
// canonical entry it names (so 'Lat Pulldown or Chin-Up' -> Pull-Ups). A pool
// with no other eligible target returns `entry` itself (caller treats that as
// "no rotation").
export function nextRotationEntry(entry: CatalogEntry): CatalogEntry {
  const pool = POOLS[entry.pattern]
  let index = pool.indexOf(entry)
  if (entry.aliasOf) {
    const canonical = pool.findIndex(candidate => candidate.name === entry.aliasOf)
    if (canonical !== -1) index = canonical
  }
  for (let step = 1; step <= pool.length; step++) {
    const candidate = pool[(index + step) % pool.length]
    if (!candidate.aliasOf && candidate.name !== entry.name) return candidate
  }
  return entry
}

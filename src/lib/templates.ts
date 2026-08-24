// Prebuilt week templates for the plan editor. Each markdown table uses the
// exact 6-column format enforced by markdown-parser.ts (Day | Type | Notes |
// Exercise / Activity | Sets | Reps / Time), with a fully-populated first data
// row and blank-cell inheritance for grouped exercises.
//
// The routine they encode: busy parent, morning-only sessions, gym is the last
// stop before work (hard 45-min stop), park runs, 4x/week on weekdays.
// Wednesday is a deliberate buffer/rest day that absorbs a slid session.

export interface WeekTemplate {
  id: string
  name: string
  description: string
  markdown: string
}

const COMEBACK_WEEK_MARKDOWN = `| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Full-Body A ramp: ~50-60% of old weights, hard stop at 45 min -> shower -> work | Back Squat | 2 | 5 |
| | | | Bench Press | 2 | 5-8 |
| | | | One-Arm Dumbbell Row | 2 | 8 each side |
| | | | Plank (only if ahead of the clock) | 2 | 30 sec |
| Tuesday | Run | Easy run/walk from home or park, conversational pace | Run 4 min / Walk 1 min | 1 | 30 min |
| Thursday | Gym | Full-Body B ramp: ~50-60% of old weights, hard stop at 45 min -> shower -> work | Romanian Deadlift | 2 | 5-8 |
| | | | Overhead Press | 2 | 5-8 |
| | | | Lat Pulldown or Chin-Up | 2 | 8 |
| | | | Farmer Carry (only if ahead of the clock) | 2 | 30 m |
| Friday | Run | Easy run/walk, same effort as Tuesday, a little longer | Run 4 min / Walk 1 min | 1 | 35 min |`

const BUILD_WEEK_MARKDOWN = `| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Full-Body A: add weight only when all sets hit top reps. Hard stop 45 min -> shower -> work | Back Squat | 3 | 5 |
| | | | Bench Press | 3 | 5-8 |
| | | | One-Arm Dumbbell Row | 3 | 8 each side |
| | | | Plank (only if ahead of the clock) | 3 | 30 sec |
| Tuesday | Run | Easy continuous run from home or park | Easy Run | 1 | 30 min |
| Thursday | Gym | Full-Body B: add weight only when all sets hit top reps. Hard stop 45 min -> shower -> work | Romanian Deadlift | 3 | 5-8 |
| | | | Overhead Press | 3 | 5-8 |
| | | | Lat Pulldown or Chin-Up | 3 | 8 |
| | | | Farmer Carry (only if ahead of the clock) | 3 | 30 m |
| Friday | Run | Easy run + 4 x 20 sec relaxed strides at the end | Easy Run + Strides | 1 | 30-35 min |`

const STANDARD_WEEK_MARKDOWN = `| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Full-Body A: add weight only when all sets hit top reps. Hard stop 45 min -> shower -> work | Back Squat | 3 | 5 |
| | | | Bench Press | 3 | 5-8 |
| | | | One-Arm Dumbbell Row | 3 | 8 each side |
| | | | Plank (only if ahead of the clock) | 3 | 30 sec |
| Tuesday | Run | Easy continuous run from home or park | Easy Run | 1 | 30 min |
| Thursday | Gym | Full-Body B: add weight only when all sets hit top reps. Hard stop 45 min -> shower -> work | Romanian Deadlift | 3 | 5-8 |
| | | | Overhead Press | 3 | 5-8 |
| | | | Lat Pulldown or Chin-Up | 3 | 8 |
| | | | Farmer Carry (only if ahead of the clock) | 3 | 30 m |
| Friday | Run | Alternate weekly: tempo (3 x 5 min comfortably hard) or 40 min easy | Quality Run | 1 | 35-40 min |`

export const TEMPLATES: WeekTemplate[] = [
  {
    id: 'comeback-week',
    name: 'Comeback Week',
    description: 'Weeks 1-2 back: 2 sets, light weights, run/walk. Leave feeling fresh.',
    markdown: COMEBACK_WEEK_MARKDOWN,
  },
  {
    id: 'build-week',
    name: 'Build Week',
    description: 'Weeks 3-4: 3 sets, continuous easy runs, strides on Friday.',
    markdown: BUILD_WEEK_MARKDOWN,
  },
  {
    id: 'standard-week',
    name: 'Standard Week',
    description: 'Week 5+: full working sets. Alternate Friday tempo and longer easy runs.',
    markdown: STANDARD_WEEK_MARKDOWN,
  },
]

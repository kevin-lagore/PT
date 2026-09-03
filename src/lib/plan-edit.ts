// Free-text plan editing: turn an instruction like "swap one of the runs for a
// gym" into SURGICAL row-level edit operations on the current week's plan.
//
// Two parsers produce the same EditOp[] shape:
//   - parseInstructionWithAI: Claude structured-output call (only when
//     ANTHROPIC_API_KEY is set). ANY failure (timeout, refusal, bad parse)
//     returns null so the caller falls through to the rules parser — an AI
//     error must never surface to the user.
//   - parseInstructionRules: deterministic regexes, always available.
//
// The route (/api/plans/edit) validates ops with validateOps and applies them
// as row-level prisma calls (planRow.create/delete/update) inside a
// transaction — NEVER deleteMany+recreate the week, which would SetNull
// linkedPlanRowId on logged entries.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { DAYS, WorkoutType, normalizeExerciseName, normalizeWorkoutType } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The slim plan-row shape both parsers work over (the route maps prisma rows
// into this — keeps everything here pure and testable without a db).
export interface PlanRowLite {
  id: string
  day: string
  type: string
  exercise: string
  setsText: string
  repsTimeText: string
  notes: string
  sortOrder: number
}

export interface AddOp {
  op: 'add'
  day: string
  type: string
  exercise: string
  setsText: string
  repsTimeText: string
  notes: string
}

export interface RemoveOp {
  op: 'remove'
  rowId: string
}

export type EditableFields = Partial<
  Pick<PlanRowLite, 'day' | 'type' | 'exercise' | 'setsText' | 'repsTimeText' | 'notes'>
>

export interface UpdateOp {
  op: 'update'
  rowId: string
  fields: EditableFields
}

export type EditOp = AddOp | RemoveOp | UpdateOp

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Day-name matchers, tolerant of common abbreviations (mon, tues, weds, thurs...).
// Written so 'thus' does NOT match Thursday and 'sunny' does not match Sunday.
const DAY_MATCHERS: { day: string; re: RegExp }[] = [
  { day: 'Monday', re: /\bmon(?:day)?\b/i },
  { day: 'Tuesday', re: /\btues?(?:day)?\b/i },
  { day: 'Wednesday', re: /\bwed(?:s|nesday)?\b/i },
  { day: 'Thursday', re: /\bthu(?:rs?)?(?:day)?\b/i },
  { day: 'Friday', re: /\bfri(?:day)?\b/i },
  { day: 'Saturday', re: /\bsat(?:urday)?\b/i },
  { day: 'Sunday', re: /\bsun(?:day)?\b/i },
]

function findDayMatcher(text: string): { day: string; re: RegExp } | null {
  for (const matcher of DAY_MATCHERS) {
    if (matcher.re.test(text)) return matcher
  }
  return null
}

function findDayName(text: string): string | null {
  return findDayMatcher(text)?.day ?? null
}

// Loose type keyword sniffing for free text ('lifting', 'jog', 'weights'...).
// Circuit is checked first so 'park circuit workout' never reads as Gym.
function findTypeKeyword(text: string): WorkoutType | null {
  if (/\bcircuits?\b/i.test(text)) return 'Circuit'
  if (/\bruns?\b|\brunning\b|\bjogs?\b|\bjogging\b/i.test(text)) return 'Run'
  if (/\bgym\b|\blifts?\b|\blifting\b|\bweights?\b|\bstrength\b/i.test(text)) return 'Gym'
  if (/\bactivit(?:y|ies)\b/i.test(text)) return 'Activity'
  return null
}

function canonicalRowType(row: PlanRowLite): string {
  return normalizeWorkoutType(row.type) ?? row.type
}

const GYM_NOTE = 'Find a comfortable weight - leave 2-3 reps in reserve'

// Sensible default rows the rules parser adds for a bare "add a <type>" /
// "swap X for a <type>" instruction. Gym = one squat/push/pull trio.
export function defaultRowsForType(type: WorkoutType, day: string, parkMentioned: boolean): AddOp[] {
  switch (type) {
    case 'Gym':
      return [
        { op: 'add', day, type: 'Gym', exercise: 'Back Squat', setsText: '3', repsTimeText: '5', notes: GYM_NOTE },
        { op: 'add', day, type: 'Gym', exercise: 'Bench Press', setsText: '3', repsTimeText: '5-8', notes: GYM_NOTE },
        { op: 'add', day, type: 'Gym', exercise: 'One-Arm Dumbbell Row', setsText: '3', repsTimeText: '8 each side', notes: GYM_NOTE },
      ]
    case 'Run':
      return [
        { op: 'add', day, type: 'Run', exercise: 'Easy Run', setsText: '1', repsTimeText: '30 min', notes: 'Conversational pace' },
      ]
    case 'Circuit':
      return [
        {
          op: 'add',
          day,
          type: 'Circuit',
          exercise: parkMentioned ? 'Park Circuit' : 'Circuit',
          setsText: '3',
          repsTimeText: '15-20 min',
          notes: '',
        },
      ]
    case 'Activity':
      return [
        { op: 'add', day, type: 'Activity', exercise: 'Activity', setsText: '1', repsTimeText: '30 min', notes: '' },
      ]
  }
}

// ---------------------------------------------------------------------------
// Rules parser (always available)
// ---------------------------------------------------------------------------

const SWAP_VERB_RE = /\b(?:swap|switch|replace)\b/i
const ADD_VERB_RE = /\b(?:add|include|schedule)\b/i
const REMOVE_VERB_RE = /\b(?:remove|delete|drop|cancel|skip|scrap)\b/i

// Deterministic parser: (instruction, rows, todayName) -> EditOp[] | null.
// todayName is the server's current weekday name — the default day for adds.
// null = could not understand (the route answers 400 with example phrasings).
export function parseInstructionRules(
  instruction: string,
  rows: PlanRowLite[],
  todayName: string
): EditOp[] | null {
  const text = instruction.trim()
  if (!text) return null

  // Exactly one intent verb family — compound instructions ('remove X and add
  // Y') are the AI parser's job; a half-applied rules guess would be worse
  // than the 400 + examples the caller returns for null.
  const hasSwap = SWAP_VERB_RE.test(text)
  const hasAdd = ADD_VERB_RE.test(text)
  const hasRemove = REMOVE_VERB_RE.test(text)
  if ([hasSwap, hasAdd, hasRemove].filter(Boolean).length !== 1) return null

  if (hasSwap) return parseSwap(text, rows)
  if (hasAdd) return parseAdd(text, todayName)
  return parseRemove(text, rows)
}

// 'swap|switch|replace <old...> for|with|to <new...>' — both sides must name a
// workout type. Deletes the chosen day's rows of the old type and adds default
// rows of the new. Day comes from either side; 'one of the runs' (no day)
// picks the first old-type row's day in sortOrder.
function parseSwap(text: string, rows: PlanRowLite[]): EditOp[] | null {
  const match = /\b(?:swap|switch|replace)\b(.+?)\b(?:for|with|to)\b(.+)$/i.exec(text)
  if (!match) return null
  const oldPart = match[1]
  const newPart = match[2]

  const oldType = findTypeKeyword(oldPart)
  const newType = findTypeKeyword(newPart)
  if (!oldType || !newType || oldType === newType) return null

  const oldTypeRows = rows
    .filter(row => canonicalRowType(row) === oldType)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const day = findDayName(oldPart) ?? findDayName(newPart) ?? oldTypeRows[0]?.day ?? null
  if (!day) return null

  const dayRows = oldTypeRows.filter(row => row.day === day)
  if (dayRows.length === 0) return null

  return [
    ...dayRows.map((row): RemoveOp => ({ op: 'remove', rowId: row.id })),
    ...defaultRowsForType(newType, day, /\bpark\b/i.test(newPart)),
  ]
}

// 'add [in] [a|an] [extra] [park] <circuit|run|gym ...> [on <day>]' — day
// defaults to today. Gym adds the squat/push/pull trio; circuit and run add a
// single default row.
function parseAdd(text: string, todayName: string): EditOp[] | null {
  const match = /\b(?:add|include|schedule)\b(.+)$/i.exec(text)
  if (!match) return null
  const rest = match[1]

  const type = findTypeKeyword(rest)
  if (!type) return null

  const day = findDayName(rest) ?? todayName
  return defaultRowsForType(type, day, /\bpark\b/i.test(rest))
}

// 'remove [the] <exercise name or type> [on|from <day>]'. Matching order:
//   1. bare day ('skip friday') -> everything on that day
//   2. fuzzy exercise-name containment against this week's rows
//   3. workout-type keyword -> all rows of that type (on the day, if given)
function parseRemove(text: string, rows: PlanRowLite[]): EditOp[] | null {
  const match = /\b(?:remove|delete|drop|cancel|skip|scrap)\b(.+)$/i.exec(text)
  if (!match) return null
  let rest = match[1]

  const dayMatcher = findDayMatcher(rest)
  const day = dayMatcher?.day ?? null
  if (dayMatcher) rest = rest.replace(dayMatcher.re, ' ')

  rest = rest
    .replace(/\b(?:the|a|an|my|this|that|please|on|from|for|of|all|entire|whole|session|sessions|workout|workouts)\b/gi, ' ')
    .replace(/'s\b/gi, ' ')
    .replace(/[^a-zA-Z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const candidates = day ? rows.filter(row => row.day === day) : rows

  if (!rest) {
    if (!day || candidates.length === 0) return null
    return candidates.map((row): RemoveOp => ({ op: 'remove', rowId: row.id }))
  }

  const targetNorm = normalizeExerciseName(rest)
  const nameMatches = candidates.filter(row => {
    const rowNorm = normalizeExerciseName(row.exercise)
    return rowNorm.includes(targetNorm) || targetNorm.includes(rowNorm)
  })
  if (nameMatches.length > 0) {
    return nameMatches.map((row): RemoveOp => ({ op: 'remove', rowId: row.id }))
  }

  const type = findTypeKeyword(rest)
  if (type) {
    const typeMatches = candidates.filter(row => canonicalRowType(row) === type)
    if (typeMatches.length > 0) {
      return typeMatches.map((row): RemoveOp => ({ op: 'remove', rowId: row.id }))
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Summaries (the rules parser's summary; also the fallback for empty AI ones)
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<keyof EditableFields, string> = {
  day: 'day',
  type: 'type',
  exercise: 'exercise',
  setsText: 'sets',
  repsTimeText: 'reps/time',
  notes: 'notes',
}

export function summarizeOps(ops: EditOp[], rows: PlanRowLite[]): string[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  return ops.map(op => {
    if (op.op === 'add') {
      return `Added ${op.exercise} (${op.type}, ${op.setsText} x ${op.repsTimeText}) on ${op.day}`
    }
    if (op.op === 'remove') {
      const row = byId.get(op.rowId)
      return row ? `Removed ${row.exercise} (${row.type}) from ${row.day}` : 'Removed a plan row'
    }
    const row = byId.get(op.rowId)
    const name = row ? `${row.exercise} (${row.day})` : 'a plan row'
    const changes = (Object.entries(op.fields) as [keyof EditableFields, string][])
      .map(([key, value]) => `${FIELD_LABELS[key]} -> ${value === '' ? '(empty)' : value}`)
      .join(', ')
    return `Updated ${name}: ${changes}`
  })
}

// ---------------------------------------------------------------------------
// Validation (both parsers' output goes through this before applying)
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true; ops: EditOp[] } | { ok: false; errors: string[] }

function canonicalDay(raw: string): string | null {
  const target = raw.trim().toLowerCase()
  return DAYS.find(day => day.toLowerCase() === target) ?? null
}

// Checks every op against this week's rows and canonicalizes days/types.
// Duplicate removes of the same row are deduped; an update touching a row that
// is also being removed is an error (the transaction would blow up on it).
export function validateOps(ops: EditOp[], rows: PlanRowLite[]): ValidationResult {
  const errors: string[] = []
  const rowIds = new Set(rows.map(row => row.id))
  const removedIds = new Set(
    ops.filter((op): op is RemoveOp => op.op === 'remove').map(op => op.rowId)
  )
  const seenRemoves = new Set<string>()
  const normalized: EditOp[] = []

  ops.forEach((op, index) => {
    if (op.op === 'add') {
      const type = normalizeWorkoutType(op.type)
      const day = canonicalDay(op.day)
      const exercise = op.exercise.trim()
      if (!type) errors.push(`Change ${index + 1}: unknown workout type: ${op.type} (use Gym, Run, Circuit or Activity)`)
      if (!day) errors.push(`Change ${index + 1}: unknown day: ${op.day} (use Monday to Sunday)`)
      if (!exercise) errors.push(`Change ${index + 1}: added row needs an exercise name`)
      if (type && day && exercise) normalized.push({ ...op, type, day, exercise })
      return
    }

    if (!rowIds.has(op.rowId)) {
      errors.push(`Change ${index + 1}: no matching row in this week's plan`)
      return
    }

    if (op.op === 'remove') {
      if (seenRemoves.has(op.rowId)) return // dedupe
      seenRemoves.add(op.rowId)
      normalized.push(op)
      return
    }

    if (removedIds.has(op.rowId)) {
      errors.push(`Change ${index + 1}: cannot update a row that is also being removed`)
      return
    }

    const fields: EditableFields = {}
    if (op.fields.day !== undefined) {
      const day = canonicalDay(op.fields.day)
      if (!day) {
        errors.push(`Change ${index + 1}: unknown day: ${op.fields.day} (use Monday to Sunday)`)
        return
      }
      fields.day = day
    }
    if (op.fields.type !== undefined) {
      const type = normalizeWorkoutType(op.fields.type)
      if (!type) {
        errors.push(`Change ${index + 1}: unknown workout type: ${op.fields.type} (use Gym, Run, Circuit or Activity)`)
        return
      }
      fields.type = type
    }
    for (const key of ['exercise', 'setsText', 'repsTimeText', 'notes'] as const) {
      const value = op.fields[key]
      if (value !== undefined) fields[key] = value
    }
    if (Object.keys(fields).length === 0) {
      errors.push(`Change ${index + 1}: update has no fields to change`)
      return
    }
    normalized.push({ op: 'update', rowId: op.rowId, fields })
  })

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, ops: normalized }
}

// ---------------------------------------------------------------------------
// AI parser (only when ANTHROPIC_API_KEY is set)
// ---------------------------------------------------------------------------

// Structured-output schema. Update fields are nullable-required (not optional)
// because strict output formats want every key present; nulls mean 'unchanged'
// and are stripped when converting to EditOp.
const UpdateFieldsSchema = z.object({
  day: z.string().nullable(),
  type: z.string().nullable(),
  exercise: z.string().nullable(),
  setsText: z.string().nullable(),
  repsTimeText: z.string().nullable(),
  notes: z.string().nullable(),
})

const EditPlanSchema = z.object({
  operations: z.array(
    z.discriminatedUnion('op', [
      z.object({
        op: z.literal('add'),
        day: z.string(),
        type: z.string(),
        exercise: z.string(),
        setsText: z.string(),
        repsTimeText: z.string(),
        notes: z.string(),
      }),
      z.object({
        op: z.literal('remove'),
        rowId: z.string(),
      }),
      z.object({
        op: z.literal('update'),
        rowId: z.string(),
        fields: UpdateFieldsSchema,
      }),
    ])
  ),
  summary: z.array(z.string()),
})

function buildSystemPrompt(rows: PlanRowLite[], todayName: string): string {
  const table = rows
    .map(row => `${row.id} | ${row.day} | ${row.type} | ${row.exercise} | ${row.setsText} | ${row.repsTimeText} | ${row.notes}`)
    .join('\n')

  return [
    "You convert a user's free-text instruction into surgical edit operations on their current week's workout plan.",
    '',
    "Current week's plan rows (id | day | type | exercise | sets | reps/time | notes):",
    table,
    '',
    `Today is ${todayName}.`,
    'Allowed workout types: Gym, Run, Circuit, Activity.',
    'Day names: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.',
    '',
    'Guidance:',
    '- Keep changes minimal. Never touch rows the user did not reference.',
    '- remove/update operations must use a rowId copied exactly from the table above.',
    "- \"add a park circuit\" style requests create one Circuit row: exercise 'Park Circuit', sets '3', reps '15-20 min'.",
    "- Swapping a day's run for a gym session means: remove that day's Run rows and add 2-4 sensible Gym rows with sets/reps (choose common exercises, e.g. squat/press/row).",
    "- If the user names no day for an added row, use today's day.",
    '- In update operations set every unchanged field to null.',
    '- summary: one short human sentence per applied change.',
  ].join('\n')
}

const AI_TIMEOUT_MS = 15_000

// Claude-backed parser. Returns null on ANY failure — no key, timeout,
// refusal, unparseable output, or zero usable operations — so the caller can
// fall through to the rules parser.
export async function parseInstructionWithAI(
  instruction: string,
  rows: PlanRowLite[],
  todayName: string
): Promise<{ ops: EditOp[]; summary: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  try {
    const client = new Anthropic() // reads ANTHROPIC_API_KEY
    const response = await client.messages.parse(
      {
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: zodOutputFormat(EditPlanSchema) },
        system: buildSystemPrompt(rows, todayName),
        messages: [{ role: 'user', content: instruction }],
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
    )

    if (response.stop_reason === 'refusal') return null
    const parsed = response.parsed_output
    if (!parsed || parsed.operations.length === 0) return null

    const ops: EditOp[] = []
    for (const raw of parsed.operations) {
      if (raw.op === 'add') {
        ops.push({
          op: 'add',
          day: raw.day,
          type: raw.type,
          exercise: raw.exercise,
          setsText: raw.setsText,
          repsTimeText: raw.repsTimeText,
          notes: raw.notes,
        })
      } else if (raw.op === 'remove') {
        ops.push({ op: 'remove', rowId: raw.rowId })
      } else {
        const fields: EditableFields = {}
        for (const key of ['day', 'type', 'exercise', 'setsText', 'repsTimeText', 'notes'] as const) {
          const value = raw.fields[key]
          if (value !== null) fields[key] = value
        }
        if (Object.keys(fields).length > 0) {
          ops.push({ op: 'update', rowId: raw.rowId, fields })
        }
      }
    }

    if (ops.length === 0) return null
    return { ops, summary: parsed.summary }
  } catch {
    return null
  }
}

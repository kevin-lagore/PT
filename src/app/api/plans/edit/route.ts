import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getDayOfWeek, getMonday } from '@/lib/types'
import {
  EditOp,
  PlanRowLite,
  parseInstructionRules,
  parseInstructionWithAI,
  summarizeOps,
  validateOps,
} from '@/lib/plan-edit'

const EXAMPLE_PHRASINGS = [
  '"add in an extra park based circuit workout"',
  '"swap one of the runs for a gym"',
  '"remove the run on Friday"',
]

// POST /api/plans/edit — body { instruction: string }. Applies a free-text
// instruction to the CURRENT week's plan.
//   200 { summary: string[], method: 'ai' | 'rules' }
//   400 { errors: string[] } — unparseable instruction or no plan this week.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
  if (!instruction) {
    return NextResponse.json({ errors: ['instruction (string) is required'] }, { status: 400 })
  }

  // Current week only — exact-equality Monday match, like /api/plans GET.
  const monday = getMonday(new Date())
  const plan = await prisma.weekPlan.findFirst({
    where: { weekStartDate: monday },
    include: { rows: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!plan) {
    return NextResponse.json(
      { errors: ['No plan this week to edit - create one first'] },
      { status: 400 }
    )
  }

  const rows: PlanRowLite[] = plan.rows.map(row => ({
    id: row.id,
    day: row.day,
    type: row.type,
    exercise: row.exercise,
    setsText: row.setsText,
    repsTimeText: row.repsTimeText,
    notes: row.notes,
    sortOrder: row.sortOrder,
  }))
  const todayName = getDayOfWeek(new Date())

  // AI parser first (only when a key is configured); ANY AI failure silently
  // falls through to the deterministic rules parser.
  let ops: EditOp[] | null = null
  let summary: string[] | null = null
  let method: 'ai' | 'rules' = 'rules'

  if (process.env.ANTHROPIC_API_KEY) {
    const ai = await parseInstructionWithAI(instruction, rows, todayName)
    if (ai) {
      ops = ai.ops
      summary = ai.summary
      method = 'ai'
    }
  }

  if (!ops) {
    ops = parseInstructionRules(instruction, rows, todayName)
  }

  if (!ops || ops.length === 0) {
    return NextResponse.json(
      { errors: ['Could not understand that. Try e.g.:', ...EXAMPLE_PHRASINGS] },
      { status: 400 }
    )
  }

  const validation = validateOps(ops, rows)
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 })
  }

  // Apply SURGICALLY as row-level calls in one transaction. NEVER
  // deleteMany+recreate the week — that would SetNull linkedPlanRowId on
  // already-logged entries.
  const maxSortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), -1)
  let addIndex = 0
  const calls: Prisma.PrismaPromise<unknown>[] = validation.ops.map(op => {
    if (op.op === 'add') {
      return prisma.planRow.create({
        data: {
          weekPlanId: plan.id,
          day: op.day,
          type: op.type,
          exercise: op.exercise,
          setsText: op.setsText,
          repsTimeText: op.repsTimeText,
          notes: op.notes,
          sortOrder: maxSortOrder + 1 + addIndex++,
        },
      })
    }
    if (op.op === 'remove') {
      return prisma.planRow.delete({ where: { id: op.rowId } })
    }
    return prisma.planRow.update({ where: { id: op.rowId }, data: op.fields })
  })
  await prisma.$transaction(calls)

  // The rules parser (and an AI response with an empty summary) gets its
  // sentences built from the applied ops.
  if (!summary || summary.length === 0) {
    summary = summarizeOps(validation.ops, rows)
  }

  return NextResponse.json({ summary, method })
}

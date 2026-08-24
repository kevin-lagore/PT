import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { calculateXP, normalizeWorkoutType, normalizeExerciseName, epley1RM, PRInfo } from '@/lib/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    type,
    exerciseOrActivity,
    setsCompleted,
    reps,
    weight,
    km,
    circuitsCompleted,
    manualXP,
    notes,
    linkedPlanRowId,
    date
  } = body

  const canonicalType = normalizeWorkoutType(typeof type === 'string' ? type : '')
  if (canonicalType === null) {
    return NextResponse.json({ errors: [`Unknown workout type: ${type}`] }, { status: 400 })
  }

  // Calculate XP based on the canonical type
  const xp = calculateXP(canonicalType, {
    setsCompleted,
    km,
    circuitsCompleted,
    manualXP
  })

  // PR detection (after XP): compare against PRIOR logs of the same normalized
  // exercise name, fetched BEFORE creating this entry so it never counts as its
  // own prior. Name matching is fuzzy (normalizeExerciseName), so we filter in
  // JS over a slim select. First-ever log of a name is never a PR.
  let pr: PRInfo | null = null
  const needsPRCheck =
    (canonicalType === 'Gym' && weight != null) ||
    (canonicalType === 'Run' && km != null)

  if (needsPRCheck) {
    const name = normalizeExerciseName(String(exerciseOrActivity ?? ''))
    const allLogs = await prisma.logEntry.findMany({
      select: { exerciseOrActivity: true, weight: true, reps: true, km: true }
    })
    const prior = allLogs.filter(log => normalizeExerciseName(log.exerciseOrActivity) === name)

    if (prior.length > 0) {
      if (canonicalType === 'Gym' && weight != null) {
        const priorWeights = prior
          .map(log => log.weight)
          .filter((w): w is number => w != null)
        const maxWeight = priorWeights.length > 0 ? Math.max(...priorWeights) : null

        if (maxWeight != null && weight > maxWeight) {
          pr = { kind: 'weight', value: weight, previous: maxWeight, exercise: exerciseOrActivity }
        } else if (reps != null) {
          // e1RM PR: only prior entries with BOTH weight and reps are comparable.
          const e1rm = epley1RM(weight, reps)
          const priorE1RMs = prior
            .filter(log => log.weight != null && log.reps != null)
            .map(log => epley1RM(log.weight as number, log.reps as number))
          const maxE1RM = priorE1RMs.length > 0 ? Math.max(...priorE1RMs) : null

          if (maxE1RM != null && e1rm > maxE1RM) {
            pr = { kind: 'e1rm', value: e1rm, previous: maxE1RM, exercise: exerciseOrActivity }
          }
        }
      } else if (canonicalType === 'Run' && km != null) {
        const priorKms = prior
          .map(log => log.km)
          .filter((k): k is number => k != null)
        const maxKm = priorKms.length > 0 ? Math.max(...priorKms) : null

        if (maxKm != null && km > maxKm) {
          pr = { kind: 'distance', value: km, previous: maxKm, exercise: exerciseOrActivity }
        }
      }
    }
  }

  const logEntry = await prisma.logEntry.create({
    data: {
      date: date ? new Date(date) : new Date(),
      type: canonicalType,
      exerciseOrActivity,
      setsCompleted: setsCompleted ?? null,
      reps: reps ?? null,
      weight: weight ?? null,
      km: km ?? null,
      circuitsCompleted: circuitsCompleted ?? null,
      xp,
      notes: notes ?? null,
      linkedPlanRowId: linkedPlanRowId ?? null
    }
  })

  return NextResponse.json({ ...logEntry, xp, pr })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  try {
    await prisma.logEntry.delete({
      where: { id }
    })
  } catch (error) {
    // P2025 = record to delete does not exist
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ errors: ['Log not found'] }, { status: 404 })
    }
    throw error
  }

  return NextResponse.json({ success: true })
}

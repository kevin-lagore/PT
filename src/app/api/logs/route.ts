import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { calculateXP } from '@/lib/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    type,
    exerciseOrActivity,
    setsCompleted,
    km,
    circuitsCompleted,
    manualXP,
    notes,
    linkedPlanRowId,
    date
  } = body

  // Calculate XP based on type
  const xp = calculateXP(type, {
    setsCompleted,
    km,
    circuitsCompleted,
    manualXP
  })

  const logEntry = await prisma.logEntry.create({
    data: {
      date: date ? new Date(date) : new Date(),
      type,
      exerciseOrActivity,
      setsCompleted: setsCompleted ?? null,
      km: km ?? null,
      circuitsCompleted: circuitsCompleted ?? null,
      xp,
      notes: notes ?? null,
      linkedPlanRowId: linkedPlanRowId ?? null
    }
  })

  return NextResponse.json({ ...logEntry, xp })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  await prisma.logEntry.delete({
    where: { id }
  })

  return NextResponse.json({ success: true })
}

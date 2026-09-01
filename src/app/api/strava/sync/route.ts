import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isStravaConfigured, syncStrava } from '@/lib/strava'

export const dynamic = 'force-dynamic'

export async function POST() {
  if (!isStravaConfigured()) {
    return NextResponse.json(
      { errors: ['Strava is not configured (set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET)'] },
      { status: 400 }
    )
  }

  const refreshToken = await prisma.setting.findUnique({
    where: { key: 'strava_refresh_token' }
  })
  if (!refreshToken) {
    return NextResponse.json(
      { errors: ['Strava is not connected — visit /api/strava/auth first'] },
      { status: 400 }
    )
  }

  try {
    const result = await syncStrava()
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Strava sync failed'
    return NextResponse.json({ errors: [message] }, { status: 502 })
  }
}

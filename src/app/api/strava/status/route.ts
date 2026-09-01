import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isStravaConfigured } from '@/lib/strava'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [refreshToken, lastSync] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'strava_refresh_token' } }),
    prisma.setting.findUnique({ where: { key: 'strava_last_sync' } })
  ])

  return NextResponse.json({
    configured: isStravaConfigured(),
    connected: refreshToken !== null,
    lastSync: lastSync?.value ?? null
  })
}

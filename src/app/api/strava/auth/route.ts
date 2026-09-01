import { NextRequest, NextResponse } from 'next/server'
import { isStravaConfigured, buildAuthUrl, getPublicOrigin } from '@/lib/strava'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isStravaConfigured()) {
    return NextResponse.json(
      { errors: ['Strava is not configured (set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET)'] },
      { status: 400 }
    )
  }

  // getPublicOrigin is shared with the callback route — Strava requires the
  // redirect_uri to match between authorize and callback.
  return NextResponse.redirect(buildAuthUrl(getPublicOrigin(request)))
}

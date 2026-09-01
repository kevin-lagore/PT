import { NextRequest, NextResponse } from 'next/server'
import { isStravaConfigured, exchangeCode, storeTokens, getPublicOrigin } from '@/lib/strava'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Same origin logic as /api/strava/auth (Strava requires matching URIs).
  const origin = getPublicOrigin(request)

  try {
    const code = new URL(request.url).searchParams.get('code')
    if (!code || !isStravaConfigured()) {
      return NextResponse.redirect(`${origin}/?strava=error`)
    }

    const tokens = await exchangeCode(code)
    await storeTokens(tokens)

    return NextResponse.redirect(`${origin}/?strava=connected`)
  } catch {
    return NextResponse.redirect(`${origin}/?strava=error`)
  }
}

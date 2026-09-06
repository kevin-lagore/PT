'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  Dumbbell,
  Flame,
  Loader2,
  RefreshCw,
  Target,
  Timer,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getDayOfWeek } from '@/lib/types'
import type { WeekApiResponse } from '@/lib/types'
import { WeekGoal } from './WeekGoal'

// Mirror of the CoachBrief contract in src/lib/coach.ts (built in parallel).
// Declared locally so this component only depends on the wire shape.
interface CoachBrief {
  headline: string // one blunt line, the state of play
  lines: { topic: 'action' | 'strength' | 'running' | 'consistency'; text: string }[]
  focus: string // THE one thing to work on now
  generatedAt: string // ISO
  method: 'ai' | 'computed'
}

const TOPIC_ICONS: Record<CoachBrief['lines'][number]['topic'], LucideIcon> = {
  action: Target,
  strength: Dumbbell,
  running: Timer,
  consistency: Flame,
}

const RETRY_MESSAGE = 'Could not update - tap refresh to retry'

// 'just now' / '12m ago' / '3h ago' / 'yesterday' / '4d ago'.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function CoachHome() {
  const [brief, setBrief] = useState<CoachBrief | null>(null)
  // True while the mount GET /api/coach is in flight.
  const [loadingInitial, setLoadingInitial] = useState(true)
  // True while a POST /api/coach (regenerate) is in flight.
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards concurrent regenerates (auto-refresh racing a tap): state is stale
  // inside closures, a ref is not.
  const refreshingRef = useRef(false)

  const [week, setWeek] = useState<WeekApiResponse | null>(null)
  const [weekFailed, setWeekFailed] = useState(false)

  // POST /api/coach and swap in the fresh brief. Never clears an existing
  // brief on failure — the cached one stays up with an inline retry hint.
  const regenerate = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/coach', { method: 'POST' })
      if (!res.ok) throw new Error(`POST /api/coach ${res.status}`)
      const data: { brief: CoachBrief } = await res.json()
      setBrief(data.brief)
    } catch (err) {
      console.error('Failed to regenerate coach brief:', err)
      setError(RETRY_MESSAGE)
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [])

  // Mount: show the cached brief immediately; regenerate in the background
  // when it's stale or missing. Ref-guarded against strict-mode double-mount.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/coach')
        if (!res.ok) throw new Error(`GET /api/coach ${res.status}`)
        const data: { brief: CoachBrief | null; stale: boolean } = await res.json()
        if (data.brief) setBrief(data.brief)
        setLoadingInitial(false)
        if (data.stale || !data.brief) regenerate()
      } catch (err) {
        console.error('Failed to load coach brief:', err)
        setLoadingInitial(false)
        setError(RETRY_MESSAGE)
      }
    })()
  }, [regenerate])

  // The Today CTA's data. Failures never block the screen — the CTA just
  // falls back to a generic label.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/week')
        if (!res.ok) throw new Error(`GET /api/week ${res.status}`)
        const data: WeekApiResponse = await res.json()
        if (!cancelled) setWeek(data)
      } catch (err) {
        console.error('Failed to load week data:', err)
        if (!cancelled) setWeekFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Skeleton only while there's nothing cached to show and a request is out.
  const showSkeleton = !brief && !error && (loadingInitial || refreshing)

  // Amber focus when the coach is flagging missed/skipped work.
  const focusIsCaution = brief != null && /miss|skip/i.test(brief.focus)

  // Today CTA label from the week response.
  let todayLabel: string | null = null
  if (weekFailed) {
    todayLabel = 'Open this week'
  } else if (week) {
    const todayName = getDayOfWeek(new Date(week.today + 'T00:00:00'))
    const rows = week.plan?.rows ?? []
    if (rows.length === 0) {
      todayLabel = 'No plan yet - set up your week'
    } else {
      const todayRows = rows.filter((r) => r.day === todayName)
      if (todayRows.length === 0) {
        todayLabel = 'Rest day'
      } else {
        const first = todayRows[0]
        todayLabel =
          `${first.type} - ${first.exercise}` +
          (todayRows.length > 1 ? ` +${todayRows.length - 1} more` : '')
      }
    }
  }

  return (
    <div className="pb-24 px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Coach</h1>
        <div className="flex items-center gap-2">
          {brief && (
            <span className="text-xs text-zinc-500">Updated {relativeTime(brief.generatedAt)}</span>
          )}
          <button
            onClick={regenerate}
            disabled={refreshing}
            title="Refresh coach brief"
            aria-label="Refresh coach brief"
            className="p-2 text-zinc-400 hover:text-white disabled:opacity-60 active:scale-95 transition-transform"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-amber-400 mb-2">{error}</p>}

      {/* Brief card */}
      {brief ? (
        <div className="relative bg-zinc-900 rounded-xl p-4">
          {refreshing && (
            <Loader2 className="absolute top-3 right-3 w-4 h-4 text-zinc-500 animate-spin" />
          )}
          <h2 className="text-lg font-semibold text-white pr-6">{brief.headline}</h2>

          {brief.lines.length > 0 && (
            <div className="mt-3 space-y-2">
              {brief.lines.map((line, i) => {
                const Icon = TOPIC_ICONS[line.topic] ?? Target
                return (
                  <div key={i} className="flex items-start gap-2">
                    <Icon className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-zinc-300">{line.text}</p>
                  </div>
                )
              })}
            </div>
          )}

          <div
            className={`mt-4 rounded-lg p-3 border ${
              focusIsCaution
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-emerald-500/10 border-emerald-500/30'
            }`}
          >
            <div
              className={`text-xs font-medium uppercase tracking-wide mb-1 ${
                focusIsCaution ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              Focus
            </div>
            <p className="text-white text-sm">{brief.focus}</p>
          </div>
        </div>
      ) : showSkeleton ? (
        <div className="bg-zinc-900 rounded-xl p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-zinc-800 rounded w-3/4" />
            <div className="h-4 bg-zinc-800 rounded w-full" />
            <div className="h-4 bg-zinc-800 rounded w-5/6" />
            <div className="h-16 bg-zinc-800 rounded-lg" />
          </div>
          <p className="text-sm text-zinc-500 mt-3">Your coach is looking at your training...</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl p-4">
          <p className="text-sm text-zinc-400">No coach brief yet.</p>
        </div>
      )}

      {/* Today CTA */}
      <Link
        href="/week"
        className="block bg-zinc-900 rounded-xl p-4 mt-3 active:scale-95 transition-transform"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-0.5">Today</div>
            {todayLabel != null ? (
              <div className="text-white font-medium truncate">{todayLabel}</div>
            ) : (
              <div className="h-5 w-40 bg-zinc-800 rounded animate-pulse" />
            )}
          </div>
          <ChevronRight className="w-5 h-5 text-zinc-500 flex-shrink-0" />
        </div>
        {week && (
          <WeekGoal
            sessionDays={week.sessionDays}
            sessionGoal={week.sessionGoal}
            streak={week.streak}
            comebackMode={week.comebackMode}
            lastWorkoutDaysAgo={week.lastWorkoutDaysAgo}
            todayStr={week.today}
          />
        )}
      </Link>

      {brief?.method === 'computed' && (
        <p className="text-xs text-zinc-600 mt-3">
          offline summary - connect ANTHROPIC_API_KEY for full coaching
        </p>
      )}
    </div>
  )
}

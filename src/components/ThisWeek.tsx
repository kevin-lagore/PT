'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { DAYS, getDayOfWeek, normalizeWorkoutType } from '@/lib/types'
import type { LastEntry, PlanRowWithLogs, PRInfo, ToastMessage, WeekApiResponse } from '@/lib/types'
import { TEMPLATES } from '@/lib/templates'
import { FastLogButton } from './FastLogButton'
import { XPToast } from './XPToast'
import { WeekGoal } from './WeekGoal'
import { Check, CheckCheck, ChevronDown, ChevronUp, X } from 'lucide-react'

type RowLogEntry = PlanRowWithLogs['logEntries'][number]

// Full log entry shape inside WeekApiResponse.logs (Prisma LogEntry after JSON
// serialization). Used to rebuild a deleted entry for Undo.
interface FullLogEntry {
  id: string
  date: string
  type: string
  exerciseOrActivity: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  circuitsCompleted: number | null
  xp: number
  notes: string | null
  linkedPlanRowId: string | null
}

// Fields re-POSTed to /api/logs when the user taps Undo after a delete.
interface UndoPayload {
  type: string
  exerciseOrActivity: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  circuitsCompleted: number | null
  notes: string | null
  linkedPlanRowId: string | null
  date: string
  // Activity XP is manual and not derivable from stored fields — carried
  // through so a restore recreates the entry with its original XP.
  manualXP?: number
}

interface LogData {
  type: string
  exerciseOrActivity: string
  setsCompleted?: number
  reps?: number
  weight?: number
  km?: number
  circuitsCompleted?: number
  manualXP?: number
  notes?: string
  linkedPlanRowId?: string
}

// Trim to at most 1 decimal, dropping a trailing '.0' (60 -> '60', 62.5 -> '62.5').
function formatNumber(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

function prMessage(pr: PRInfo): string {
  if (pr.kind === 'distance') return `Longest run: ${formatNumber(pr.value)} km!`
  if (pr.kind === 'e1rm') return `New PR: ${formatNumber(pr.value)} kg est. 1RM ${pr.exercise}!`
  return `New PR: ${formatNumber(pr.value)} kg ${pr.exercise}!`
}

function agoText(daysAgo: number): string {
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  return `${daysAgo}d ago`
}

// Compact description of a prior gym session's sets:
// uniform -> '3x8 @ 60kg', same weight -> '60kg x 8,8,7', mixed -> per-set list.
function describeSets(sets: LastEntry['sets']): string | null {
  if (sets.length === 0) return null
  const weights = sets.map((s) => s.weight)
  const reps = sets.map((s) => s.reps)
  const hasWeight = weights.some((w) => w != null)
  const hasReps = reps.some((r) => r != null)
  if (!hasWeight && !hasReps) return null

  const uniformWeight = weights.every((w) => w === weights[0])
  const uniformReps = reps.every((r) => r === reps[0])

  if (!hasWeight) {
    // Bodyweight: reps only.
    if (uniformReps && reps[0] != null) return `${sets.length}x${reps[0]}`
    return `${reps.map((r) => r ?? '?').join(',')} reps`
  }
  if (uniformWeight && uniformReps && weights[0] != null && reps[0] != null) {
    return `${sets.length}x${reps[0]} @ ${formatNumber(weights[0])}kg`
  }
  if (uniformWeight && weights[0] != null) {
    return `${formatNumber(weights[0])}kg x ${reps.map((r) => r ?? '?').join(',')}`
  }
  return sets
    .map((s) => `${s.reps ?? '?'}x${s.weight != null ? `${formatNumber(s.weight)}kg` : '?'}`)
    .join(', ')
}

export function ThisWeek() {
  const [data, setData] = useState<WeekApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [pendingUndo, setPendingUndo] = useState<UndoPayload | null>(null)
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set())
  const [loggingRow, setLoggingRow] = useState<string | null>(null)
  const [planAction, setPlanAction] = useState<'comeback' | 'copy' | null>(null)

  // Today-first: start with every day collapsed EXCEPT today (client-local).
  // On weekends everything starts collapsed (the recap card leads instead).
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => {
    const todayName = getDayOfWeek(new Date())
    const weekend = todayName === 'Saturday' || todayName === 'Sunday'
    return new Set(weekend ? DAYS : DAYS.filter((d) => d !== todayName))
  })

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/week')
      if (!res.ok) throw new Error(`GET /api/week ${res.status}`)
      const weekData: WeekApiResponse = await res.json()
      setData(weekData)
      // Prune suppressed ids that the server no longer returns (delete confirmed).
      setSuppressedIds((prev) => {
        if (prev.size === 0) return prev
        const present = new Set<string>()
        for (const row of weekData.plan?.rows ?? []) {
          for (const log of row.logEntries) present.add(log.id)
        }
        const next = new Set([...prev].filter((id) => present.has(id)))
        return next.size === prev.size ? prev : next
      })
    } catch (error) {
      console.error('Failed to fetch week data:', error)
      setToast({ kind: 'error', message: 'Could not load this week — try again' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Reconcile day expansion with the SERVER's today — the same clock that
  // buckets sessionDays and the week window — once data arrives or the server
  // day rolls over. Weekends collapse everything unless today has planned rows
  // (then today stays expanded and the recap steps aside).
  useEffect(() => {
    if (!data?.today) return
    const todayName = getDayOfWeek(new Date(data.today + 'T00:00:00'))
    const weekend = todayName === 'Saturday' || todayName === 'Sunday'
    const todayHasRows = (data.plan?.rows ?? []).some((r) => r.day === todayName)
    setCollapsedDays(
      new Set(weekend && !todayHasRows ? DAYS : DAYS.filter((d) => d !== todayName))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.today])

  const showLogToast = (xp: number, pr: PRInfo | null) => {
    if (pr) setToast({ kind: 'pr', xp, message: prMessage(pr) })
    else setToast({ kind: 'xp', xp })
  }

  // Returns true on success so callers only clear form state when the save landed.
  // silentError: skip the error toast — the caller surfaces its own error UI
  // (FastLogButton shows an inline message inside its sheet).
  const handleLog = async (logData: LogData, opts?: { silentError?: boolean }): Promise<boolean> => {
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData),
      })
      if (!res.ok) {
        if (!opts?.silentError) setToast({ kind: 'error', message: 'Could not save — try again' })
        return false
      }
      const result = await res.json()
      showLogToast(result.xp, result.pr ?? null)
      fetchData()
      return true
    } catch (error) {
      console.error('Failed to save log:', error)
      if (!opts?.silentError) setToast({ kind: 'error', message: 'Could not save — try again' })
      return false
    }
  }

  const handleRowLog = async (row: PlanRowWithLogs, value: number): Promise<boolean> => {
    setLoggingRow(row.id)
    try {
      const logData: LogData = {
        type: row.type,
        exerciseOrActivity: row.exercise,
        linkedPlanRowId: row.id,
      }

      const typeLower = row.type.toLowerCase()
      if (typeLower.startsWith('gym')) {
        logData.setsCompleted = value
      } else if (typeLower.startsWith('run')) {
        logData.km = value
      } else if (typeLower.includes('circuit')) {
        logData.circuitsCompleted = value
      } else if (typeLower.startsWith('activity')) {
        logData.manualXP = value
      }

      return await handleLog(logData)
    } finally {
      setLoggingRow(null)
    }
  }

  const handleLogSet = async (
    row: PlanRowWithLogs,
    setFields: { reps?: number; weight?: number }
  ): Promise<boolean> => {
    setLoggingRow(row.id)
    try {
      return await handleLog({
        type: row.type,
        exerciseOrActivity: row.exercise,
        linkedPlanRowId: row.id,
        setsCompleted: 1, // Each log entry = 1 set
        reps: setFields.reps,
        weight: setFields.weight,
      })
    } finally {
      setLoggingRow(null)
    }
  }

  const handleDeleteLog = async (row: PlanRowWithLogs, log: RowLogEntry) => {
    // Capture the entry's fields BEFORE deleting so Undo can re-POST them.
    // Prefer the full entry from data.logs (has type/notes/linkedPlanRowId).
    const full = (data?.logs as FullLogEntry[] | undefined)?.find((l) => l?.id === log.id)
    const undoPayload: UndoPayload = {
      type: full?.type ?? row.type,
      exerciseOrActivity: full?.exerciseOrActivity ?? row.exercise,
      setsCompleted: full ? full.setsCompleted : log.setsCompleted,
      reps: full ? full.reps : log.reps,
      weight: full ? full.weight : log.weight,
      km: full ? full.km : log.km,
      circuitsCompleted: full ? full.circuitsCompleted : log.circuitsCompleted,
      notes: full ? full.notes : null,
      linkedPlanRowId: full ? full.linkedPlanRowId : row.id,
      date: full ? full.date : log.date,
    }
    // calculateXP('Activity', ...) returns 0 without manualXP; restore the
    // stored xp verbatim so Undo can't silently zero an Activity entry.
    if (normalizeWorkoutType(undoPayload.type) === 'Activity') {
      undoPayload.manualXP = full?.xp ?? log.xp
    }

    // Optimistically hide the entry; refetch confirms and prunes the id.
    setSuppressedIds((prev) => new Set(prev).add(log.id))
    try {
      const res = await fetch(`/api/logs?id=${log.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setSuppressedIds((prev) => {
          const next = new Set(prev)
          next.delete(log.id)
          return next
        })
        setToast({ kind: 'error', message: 'Could not delete — try again' })
        return
      }
      setPendingUndo(undoPayload)
      setToast({ kind: 'action', message: 'Set deleted', actionLabel: 'Undo' })
      fetchData()
    } catch (error) {
      console.error('Failed to delete log:', error)
      setSuppressedIds((prev) => {
        const next = new Set(prev)
        next.delete(log.id)
        return next
      })
      setToast({ kind: 'error', message: 'Could not delete — try again' })
    }
  }

  const handleUndo = async () => {
    if (!pendingUndo) return
    const payload = pendingUndo
    setPendingUndo(null)
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        // Delayed so the dismissing action toast's onDone can't clear it.
        setTimeout(() => setToast({ kind: 'error', message: 'Could not restore — try again' }), 400)
        return
      }
      const result = await res.json()
      setTimeout(() => setToast({ kind: 'xp', xp: result.xp }), 400)
      fetchData()
    } catch (error) {
      console.error('Failed to restore log:', error)
      setTimeout(() => setToast({ kind: 'error', message: 'Could not restore — try again' }), 400)
    }
  }

  const handleToastDone = () => {
    setToast(null)
    setPendingUndo(null)
  }

  const handleStartComebackWeek = async () => {
    const template = TEMPLATES.find((t) => t.id === 'comeback-week')
    if (!template) return
    setPlanAction('comeback')
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: template.markdown }),
      })
      if (!res.ok) {
        setToast({ kind: 'error', message: 'Could not create plan — try again' })
        return
      }
      setToast({ kind: 'action', message: 'Comeback week is ready.' })
      await fetchData()
    } catch (error) {
      console.error('Failed to create plan:', error)
      setToast({ kind: 'error', message: 'Could not create plan — try again' })
    } finally {
      setPlanAction(null)
    }
  }

  const handleRepeatLastWeek = async () => {
    setPlanAction('copy')
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyFromWeek: 'last' }),
      })
      if (res.status === 404) {
        setToast({ kind: 'error', message: 'No previous plan found' })
        return
      }
      if (!res.ok) {
        setToast({ kind: 'error', message: 'Could not copy plan — try again' })
        return
      }
      setToast({ kind: 'action', message: "Last week's plan copied." })
      await fetchData()
    } catch (error) {
      console.error('Failed to copy plan:', error)
      setToast({ kind: 'error', message: 'Could not copy plan — try again' })
    } finally {
      setPlanAction(null)
    }
  }

  const toggleDay = (day: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) {
        next.delete(day)
      } else {
        next.add(day)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  // Fetch failed and we have nothing to show: offer a retry instead of the
  // empty-plan actions (which would be misleading).
  if (!data) {
    return (
      <div className="p-8 text-center">
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4 text-left">
          <div className="text-red-400 font-medium text-sm">Could not load this week</div>
          <div className="text-red-300 text-sm mt-1">Check your connection and try again.</div>
        </div>
        <button
          onClick={() => {
            setLoading(true)
            fetchData()
          }}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-6 py-3 rounded-lg active:scale-95 transition-transform"
        >
          Retry
        </button>
        <XPToast toast={toast} onDone={handleToastDone} onAction={handleUndo} />
      </div>
    )
  }

  // Use the SERVER's local day — the same clock that computed sessionDays and
  // the week window — so goal dots, 'Today' badges and the recap can't drift
  // from the data when server and phone sit in different timezones.
  const todayStr = data.today
  const todayName = getDayOfWeek(new Date(data.today + 'T00:00:00'))
  const isWeekend = todayName === 'Saturday' || todayName === 'Sunday'

  // Hide optimistically-deleted entries until refetch confirms.
  const rows: PlanRowWithLogs[] = (data.plan?.rows ?? []).map((row) =>
    suppressedIds.size === 0
      ? row
      : { ...row, logEntries: row.logEntries.filter((log) => !suppressedIds.has(log.id)) }
  )

  // Group rows by day
  const rowsByDay: Record<string, PlanRowWithLogs[]> = {}
  for (const row of rows) {
    if (!rowsByDay[row.day]) rowsByDay[row.day] = []
    rowsByDay[row.day].push(row)
  }

  // Calculate XP per day from logged entries
  const xpByDay: Record<string, number> = {}
  for (const row of rows) {
    const dayXP = row.logEntries.reduce((sum, log) => sum + log.xp, 0)
    xpByDay[row.day] = (xpByDay[row.day] || 0) + dayXP
  }

  // A planned Sat/Sun session takes precedence over the weekend recap.
  const todayHasRows = (rowsByDay[todayName] ?? []).length > 0

  return (
    <div className="pb-32">
      {/* Sticky header */}
      <div className="sticky top-0 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">This Week</h1>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-400">{data.weeklyXP || 0} XP</div>
            <div className="text-xs text-zinc-500">weekly total</div>
          </div>
        </div>
        <WeekGoal
          sessionDays={data.sessionDays}
          sessionGoal={data.sessionGoal}
          streak={data.streak}
          comebackMode={data.comebackMode}
          lastWorkoutDaysAgo={data.lastWorkoutDaysAgo}
          todayStr={todayStr}
        />
      </div>

      <MessageStrip data={data} />

      {isWeekend && !todayHasRows && <WeekendRecap data={data} />}

      {rows.length === 0 ? (
        <div className="p-8 text-center max-w-sm mx-auto">
          <p className="text-zinc-400 mb-4">No plan for this week yet.</p>
          <div className="space-y-3">
            <button
              onClick={handleStartComebackWeek}
              disabled={planAction !== null}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-medium px-6 py-4 rounded-lg active:scale-95 transition-transform"
            >
              {planAction === 'comeback' ? 'Creating...' : 'Start Comeback Week'}
            </button>
            <button
              onClick={handleRepeatLastWeek}
              disabled={planAction !== null}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 border border-zinc-700 text-white font-medium px-6 py-4 rounded-lg active:scale-95 transition-transform"
            >
              {planAction === 'copy' ? 'Copying...' : 'Repeat last week'}
            </button>
          </div>
          <a href="/plans" className="inline-block mt-4 text-sm text-zinc-500 hover:text-zinc-400">
            More options
          </a>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {DAYS.map((day) => {
            const dayRows = rowsByDay[day] || []
            const isToday = day === todayName

            if (dayRows.length === 0) {
              // Weekdays with a plan but no rows are deliberate rest days.
              if (day === 'Saturday' || day === 'Sunday') return null
              return (
                <div key={day} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${isToday ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {day}
                    </span>
                    {isToday && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        Today
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-full">
                    Rest day
                  </span>
                </div>
              )
            }

            const isCollapsed = collapsedDays.has(day)
            const dayTotalXP = xpByDay[day] || 0

            return (
              <div key={day} className={isToday ? 'bg-zinc-900/50' : ''}>
                {/* Day header */}
                <button
                  onClick={() => toggleDay(day)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${isToday ? 'text-emerald-400' : 'text-white'}`}>
                      {day}
                    </span>
                    {isToday && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {isCollapsed && (
                      <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                        {dayRows.length} exercise{dayRows.length === 1 ? '' : 's'}
                      </span>
                    )}
                    {dayTotalXP > 0 && (
                      <span className="text-emerald-400 font-medium">{dayTotalXP} XP</span>
                    )}
                    {isCollapsed ? (
                      <ChevronDown className="w-5 h-5 text-zinc-500" />
                    ) : (
                      <ChevronUp className="w-5 h-5 text-zinc-500" />
                    )}
                  </div>
                </button>

                {/* Exercises */}
                {!isCollapsed && (
                  <div className="px-4 pb-3 space-y-2">
                    {dayRows.map((row) => (
                      <ExerciseRow
                        key={row.id}
                        row={row}
                        onLog={handleRowLog}
                        onLogSet={handleLogSet}
                        onDeleteLog={handleDeleteLog}
                        isLogging={loggingRow === row.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <FastLogButton
        onLog={async (logData) => {
          // FastLogButton's contract: a rejected onLog keeps the sheet (and
          // form values) open, shows the message inline, and skips saving the
          // quick-repeat record. A resolved onLog means the save landed.
          const ok = await handleLog(logData, { silentError: true })
          if (!ok) throw new Error('Could not save — try again')
        }}
      />
      <XPToast toast={toast} onDone={handleToastDone} onAction={handleUndo} />
    </div>
  )
}

// Warm, state-specific one-liner under the header. Never guilt language.
function MessageStrip({ data }: { data: WeekApiResponse }) {
  const count = data.sessionDays.length
  const goal = data.sessionGoal

  let content: ReactNode
  if (count >= goal) {
    content = (
      <>
        <span className="text-emerald-400 font-medium">
          {count} of {goal}
        </span>{' '}
        — week complete.
      </>
    )
  } else if (data.comebackMode && data.lastWorkoutDaysAgo != null && data.lastWorkoutDaysAgo >= 14) {
    content = (
      <>
        Welcome back —{' '}
        <span className="text-amber-400 font-medium">{goal} sessions</span> this week relights your
        streak.
      </>
    )
  } else if (data.streak > 0 && count === goal - 1) {
    content = (
      <>
        <span className="text-emerald-400 font-medium">1 more session</span> locks in week{' '}
        {data.streak + 1}.
      </>
    )
  } else if (count === 0) {
    content = <>Fresh week, fresh start.</>
  } else {
    content = (
      <>
        <span className="text-emerald-400 font-medium">{count} down</span>, {goal - count} to go this
        week.
      </>
    )
  }

  return <div className="px-4 py-2 text-sm text-zinc-400">{content}</div>
}

// Saturday/Sunday summary card: the week is done, look back kindly.
function WeekendRecap({ data }: { data: WeekApiResponse }) {
  const count = data.sessionDays.length
  const goal = data.sessionGoal
  const met = count >= goal

  return (
    <div className="mx-4 mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white">Week recap</span>
        {met && (
          <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">
            Goal met
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-zinc-800/50 rounded-lg py-2">
          <div className={`text-lg font-bold ${met ? 'text-emerald-400' : 'text-white'}`}>
            {count}/{goal}
          </div>
          <div className="text-xs text-zinc-500">sessions</div>
        </div>
        <div className="bg-zinc-800/50 rounded-lg py-2">
          <div className="text-lg font-bold text-emerald-400">{data.weeklyXP}</div>
          <div className="text-xs text-zinc-500">XP</div>
        </div>
        <div className="bg-zinc-800/50 rounded-lg py-2">
          <div className={`text-lg font-bold ${data.streak > 0 ? 'text-emerald-400' : 'text-white'}`}>
            {data.streak}
          </div>
          <div className="text-xs text-zinc-500">wk streak</div>
        </div>
      </div>
      <div className="text-xs text-zinc-500 mt-3">Next plan starts Monday.</div>
    </div>
  )
}

function ExerciseRow({
  row,
  onLog,
  onLogSet,
  onDeleteLog,
  isLogging,
}: {
  row: PlanRowWithLogs
  onLog: (row: PlanRowWithLogs, value: number) => Promise<boolean>
  onLogSet: (row: PlanRowWithLogs, data: { reps?: number; weight?: number }) => Promise<boolean>
  onDeleteLog: (row: PlanRowWithLogs, log: RowLogEntry) => void
  isLogging: boolean
}) {
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [showSetForm, setShowSetForm] = useState(false)
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')

  const typeLower = row.type.toLowerCase()
  const isGym = typeLower.startsWith('gym')
  const isRun = typeLower.startsWith('run')
  const isCircuit = typeLower.includes('circuit')
  const isActivity = typeLower.startsWith('activity')
  // /api/logs rejects types outside these families — a log control for such a
  // row (possible in legacy data) could never succeed, so don't render one.
  const knownType = isGym || isRun || isCircuit || isActivity

  const lastEntry = row.lastEntry ?? null
  const lastSet =
    isGym && lastEntry && lastEntry.sets.length > 0
      ? lastEntry.sets[lastEntry.sets.length - 1]
      : null
  const lastSetUsable = lastSet != null && (lastSet.reps != null || lastSet.weight != null)

  // History hint line under the exercise name.
  let lastLine: string | null = null
  if (isGym && lastEntry) {
    const setsDesc = describeSets(lastEntry.sets)
    if (setsDesc) lastLine = `Last: ${setsDesc} - ${agoText(lastEntry.daysAgo)}`
  } else if (isRun && lastEntry && lastEntry.km != null) {
    lastLine = `Last: ${formatNumber(lastEntry.km)} km`
  }

  // For gym: count log entries (each entry = 1 set)
  const totalSets = isGym ? row.logEntries.length : 0
  const totalLogged = row.logEntries.reduce((sum, log) => {
    if (isGym) return sum + (log.setsCompleted || 1)
    if (isRun) return sum + (log.km || 0)
    if (isCircuit) return sum + (log.circuitsCompleted || 0)
    return sum + log.xp
  }, 0)

  const targetSets = parseInt(row.setsText) || 0
  const isComplete = isGym && totalSets >= targetSets && targetSets > 0

  const handleQuickLog = () => {
    if (isGym) {
      // Prefill from the last session's final set — never clobber typed values.
      if (lastSet) {
        if (weight === '' && lastSet.weight != null) setWeight(String(lastSet.weight))
        if (reps === '' && lastSet.reps != null) setReps(String(lastSet.reps))
      }
      setShowSetForm(true)
    } else {
      setShowInput(true)
    }
  }

  const handleSubmit = async () => {
    if (isLogging) return // Enter can fire while a POST is in flight
    const value = parseFloat(inputValue)
    if (!isNaN(value) && value > 0) {
      const ok = await onLog(row, value)
      // Keep the typed value on failure so nothing is lost.
      if (ok) {
        setInputValue('')
        setShowInput(false)
      }
    }
  }

  const handleLogSet = async (addAnother: boolean) => {
    // 'Done' with no reps typed means 'I'm finished' — close without logging a
    // phantom set (weight is retained between sets, so it alone isn't intent).
    if (!addAnother && reps.trim() === '') {
      setShowSetForm(false)
      setWeight('')
      return
    }
    const ok = await onLogSet(row, {
      reps: reps ? parseInt(reps) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
    })
    if (!ok) return // keep form state on failure
    // Keep weight, clear reps for next set
    setReps('')
    if (!addAnother) {
      setShowSetForm(false)
      setWeight('')
    }
  }

  // One-tap repeat of the last session's final set.
  const handleSameAsLastSet = async () => {
    if (!lastSet) return
    await onLogSet(row, {
      reps: lastSet.reps ?? undefined,
      weight: lastSet.weight ?? undefined,
    })
    // Form stays open for the next set.
  }

  const handleSameAsLastRun = async () => {
    if (!lastEntry || lastEntry.km == null) return
    const ok = await onLog(row, lastEntry.km)
    if (ok) {
      setInputValue('')
      setShowInput(false)
    }
  }

  const sameAsLastSetLabel = (() => {
    if (!lastSetUsable || !lastSet) return null
    if (lastSet.reps != null && lastSet.weight != null) {
      return `Same as last: ${lastSet.reps} x ${formatNumber(lastSet.weight)}kg`
    }
    if (lastSet.reps != null) return `Same as last: ${lastSet.reps} reps`
    return `Same as last: ${formatNumber(lastSet.weight as number)}kg`
  })()

  const getInputPlaceholder = () => {
    if (isRun) return 'km'
    if (isCircuit) return 'circuits'
    if (isActivity) return 'XP'
    return 'sets'
  }

  const getProgressText = () => {
    if (isGym) return `${totalSets}/${targetSets} sets`
    if (isRun) return totalLogged > 0 ? `${formatNumber(totalLogged)} km` : row.repsTimeText
    if (isCircuit) return totalLogged > 0 ? `${totalLogged} circuits` : row.setsText
    if (isActivity) return totalLogged > 0 ? `${totalLogged} XP` : row.repsTimeText
    return ''
  }

  const formatLogEntry = (log: RowLogEntry, index: number) => {
    if (isGym) {
      const parts = [`Set ${index + 1}:`]
      if (log.reps) parts.push(`${log.reps} reps`)
      if (log.weight) parts.push(`× ${log.weight}kg`)
      if (!log.reps && !log.weight) parts.push('logged')
      return parts.join(' ')
    }
    if (isRun) return `${log.km} km`
    if (isCircuit) return `${log.circuitsCompleted} circuits`
    return `${log.xp} XP`
  }

  return (
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{row.exercise}</span>
            {isComplete && <CheckCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          </div>
          <div className="text-sm text-zinc-400 mt-0.5">
            {row.notes && <span className="mr-2">{row.notes}</span>}
            <span>{row.repsTimeText}</span>
          </div>
          {lastLine && <div className="text-xs text-zinc-500 mt-0.5">{lastLine}</div>}
          {isGym && lastEntry && lastEntry.daysAgo >= 14 && (
            <span className="inline-block text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full mt-1">
              Been a while — ease back in (~10% lighter)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-zinc-500">{getProgressText()}</span>

          {!knownType ? (
            <span
              title={`Unknown type: ${row.type}`}
              className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full"
            >
              Unknown type
            </span>
          ) : showInput ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={getInputPlaceholder()}
                className="w-14 bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-white text-sm text-center"
                autoFocus
                onKeyDown={(e) => {
                  // Guard in-flight and held-key auto-repeat: each unguarded
                  // Enter would POST a duplicate log entry.
                  if (e.key === 'Enter' && !e.repeat && !isLogging) handleSubmit()
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={isLogging}
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded p-1.5"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleQuickLog}
              disabled={isLogging}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors active:scale-95 ${
                isComplete
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              {isLogging ? '...' : '+Set'}
            </button>
          )}
        </div>
      </div>

      {/* One-tap repeat for runs, shown alongside the open km input */}
      {showInput && isRun && lastEntry && lastEntry.km != null && (
        <button
          onClick={handleSameAsLastRun}
          disabled={isLogging}
          className="mt-2 w-full bg-emerald-500/20 text-emerald-400 rounded-lg py-2 text-sm font-medium active:scale-95 transition-transform"
        >
          {isLogging ? '...' : `Same as last: ${formatNumber(lastEntry.km)} km`}
        </button>
      )}

      {/* Log individual set form for gym */}
      {showSetForm && isGym && (
        <div className="mt-3 pt-3 border-t border-zinc-700">
          <div className="text-xs text-zinc-400 mb-2">Log Set {totalSets + 1}</div>
          {sameAsLastSetLabel && (
            <button
              onClick={handleSameAsLastSet}
              disabled={isLogging}
              className="w-full mb-3 bg-emerald-500/20 text-emerald-400 rounded-lg py-2 text-sm font-medium active:scale-95 transition-transform"
            >
              {isLogging ? '...' : sameAsLastSetLabel}
            </button>
          )}
          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Reps"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              className="flex-1 bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-white text-center"
              autoFocus
            />
            <span className="text-zinc-500">×</span>
            <div className="flex-1 relative">
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                placeholder="Weight"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-white text-center pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">kg</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowSetForm(false)
                setReps('')
                setWeight('')
              }}
              className="px-3 py-2 text-zinc-400 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => handleLogSet(true)}
              disabled={isLogging}
              className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm font-medium active:scale-95"
            >
              {isLogging ? '...' : 'Log + Another'}
            </button>
            <button
              onClick={() => handleLogSet(false)}
              disabled={isLogging}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium active:scale-95"
            >
              {isLogging ? '...' : 'Done'}
            </button>
          </div>
        </div>
      )}

      {/* Show logged entries */}
      {row.logEntries.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1">
          {row.logEntries.map((log, index) => (
            <div key={log.id} className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">{formatLogEntry(log, index)}</span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-xs">+{log.xp} XP</span>
                <button
                  onClick={() => onDeleteLog(row, log)}
                  className="text-zinc-500 hover:text-red-400 p-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

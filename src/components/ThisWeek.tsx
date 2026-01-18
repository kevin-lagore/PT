'use client'

import { useState, useEffect, useCallback } from 'react'
import { DAYS, getDayOfWeek } from '@/lib/types'
import { FastLogButton } from './FastLogButton'
import { XPToast } from './XPToast'
import { Check, CheckCheck, ChevronDown, ChevronUp } from 'lucide-react'

interface PlanRow {
  id: string
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
  logEntries: {
    id: string
    setsCompleted: number | null
    km: number | null
    circuitsCompleted: number | null
    xp: number
  }[]
}

interface WeekData {
  plan: { rows: PlanRow[] } | null
  weeklyXP: number
  xpByDay: Record<string, number>
  today: string
}

export function ThisWeek() {
  const [data, setData] = useState<WeekData | null>(null)
  const [loading, setLoading] = useState(true)
  const [toastXP, setToastXP] = useState<number | null>(null)
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [loggingRow, setLoggingRow] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/week')
      const weekData = await res.json()
      setData(weekData)
    } catch (error) {
      console.error('Failed to fetch week data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleLog = async (logData: {
    type: string
    exerciseOrActivity: string
    setsCompleted?: number
    km?: number
    circuitsCompleted?: number
    manualXP?: number
    notes?: string
    linkedPlanRowId?: string
  }) => {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logData),
    })
    const result = await res.json()
    setToastXP(result.xp)
    fetchData()
  }

  const handleRowLog = async (row: PlanRow, value: number) => {
    setLoggingRow(row.id)
    try {
      const logData: Parameters<typeof handleLog>[0] = {
        type: row.type,
        exerciseOrActivity: row.exercise,
        linkedPlanRowId: row.id,
      }

      const type = row.type.toLowerCase()
      if (type === 'gym') {
        logData.setsCompleted = value
      } else if (type === 'run') {
        logData.km = value
      } else if (type === 'circuit') {
        logData.circuitsCompleted = value
      } else if (type === 'activity') {
        logData.manualXP = value
      }

      await handleLog(logData)
    } finally {
      setLoggingRow(null)
    }
  }

  const toggleDay = (day: string) => {
    setCollapsedDays(prev => {
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

  const today = getDayOfWeek(new Date())
  const rows = data?.plan?.rows || []

  // Group rows by day
  const rowsByDay: Record<string, PlanRow[]> = {}
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

  return (
    <div className="pb-32">
      {/* Sticky header */}
      <div className="sticky top-0 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">This Week</h1>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-400">{data?.weeklyXP || 0} XP</div>
            <div className="text-xs text-zinc-500">weekly total</div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-zinc-400 mb-4">No plan for this week yet.</p>
          <a
            href="/plans"
            className="inline-block bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-6 py-3 rounded-lg"
          >
            Create Plan
          </a>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {DAYS.map((day) => {
            const dayRows = rowsByDay[day] || []
            if (dayRows.length === 0) return null

            const isToday = day === today
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

      <FastLogButton onLog={handleLog} />
      <XPToast xp={toastXP} onDone={() => setToastXP(null)} />
    </div>
  )
}

function ExerciseRow({
  row,
  onLog,
  isLogging,
}: {
  row: PlanRow
  onLog: (row: PlanRow, value: number) => void
  isLogging: boolean
}) {
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)

  const type = row.type.toLowerCase()
  const totalLogged = row.logEntries.reduce((sum, log) => {
    if (type === 'gym') return sum + (log.setsCompleted || 0)
    if (type === 'run') return sum + (log.km || 0)
    if (type === 'circuit') return sum + (log.circuitsCompleted || 0)
    return sum + log.xp
  }, 0)

  const targetSets = parseInt(row.setsText) || 0
  const isComplete = type === 'gym' && totalLogged >= targetSets && targetSets > 0

  const handleQuickLog = () => {
    if (type === 'gym') {
      // Log remaining sets or 1 set
      const remaining = Math.max(1, targetSets - totalLogged)
      onLog(row, remaining)
    } else {
      setShowInput(true)
    }
  }

  const handleSubmit = () => {
    const value = parseFloat(inputValue)
    if (!isNaN(value) && value > 0) {
      onLog(row, value)
      setInputValue('')
      setShowInput(false)
    }
  }

  const getInputPlaceholder = () => {
    if (type === 'run') return 'km'
    if (type === 'circuit') return 'circuits'
    if (type === 'activity') return 'XP'
    return 'sets'
  }

  const getProgressText = () => {
    if (type === 'gym') return `${totalLogged}/${targetSets} sets`
    if (type === 'run') return totalLogged > 0 ? `${totalLogged} km` : row.repsTimeText
    if (type === 'circuit') return totalLogged > 0 ? `${totalLogged} circuits` : row.setsText
    if (type === 'activity') return totalLogged > 0 ? `${totalLogged} XP` : row.repsTimeText
    return ''
  }

  return (
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{row.exercise}</span>
            {isComplete && <CheckCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          </div>
          <div className="text-sm text-zinc-400 mt-0.5">
            {row.notes && <span className="mr-2">{row.notes}</span>}
            <span>{row.repsTimeText}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm text-zinc-400">{getProgressText()}</span>

          {showInput ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={getInputPlaceholder()}
                className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-white text-sm text-center"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
              <button
                onClick={handleSubmit}
                disabled={isLogging}
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded p-1"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleQuickLog}
              disabled={isLogging}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isComplete
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              {isLogging ? '...' : type === 'gym' ? '+Set' : 'Log'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

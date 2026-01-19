'use client'

import { useState, useEffect, useCallback } from 'react'
import { DAYS, getDayOfWeek } from '@/lib/types'
import { FastLogButton } from './FastLogButton'
import { XPToast } from './XPToast'
import { Check, CheckCheck, ChevronDown, ChevronUp, X } from 'lucide-react'

interface LogEntry {
  id: string
  date: string
  setsCompleted: number | null
  reps: number | null
  weight: number | null
  km: number | null
  circuitsCompleted: number | null
  xp: number
}

interface PlanRow {
  id: string
  day: string
  type: string
  notes: string
  exercise: string
  setsText: string
  repsTimeText: string
  logEntries: LogEntry[]
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
    reps?: number
    weight?: number
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

  const handleLogSet = async (row: PlanRow, data: { reps?: number; weight?: number }) => {
    setLoggingRow(row.id)
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: row.type,
          exerciseOrActivity: row.exercise,
          linkedPlanRowId: row.id,
          setsCompleted: 1, // Each log entry = 1 set
          reps: data.reps,
          weight: data.weight,
        }),
      })
      const result = await res.json()
      setToastXP(result.xp)
      fetchData()
    } finally {
      setLoggingRow(null)
    }
  }

  const handleDeleteLog = async (logId: string) => {
    await fetch(`/api/logs?id=${logId}`, { method: 'DELETE' })
    fetchData()
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

      <FastLogButton onLog={handleLog} />
      <XPToast xp={toastXP} onDone={() => setToastXP(null)} />
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
  row: PlanRow
  onLog: (row: PlanRow, value: number) => void
  onLogSet: (row: PlanRow, data: { reps?: number; weight?: number }) => void
  onDeleteLog: (logId: string) => void
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
      setShowSetForm(true)
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

  const handleLogSet = (addAnother: boolean) => {
    onLogSet(row, {
      reps: reps ? parseInt(reps) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
    })
    // Keep weight, clear reps for next set
    setReps('')
    if (!addAnother) {
      setShowSetForm(false)
      setWeight('')
    }
  }

  const getInputPlaceholder = () => {
    if (isRun) return 'km'
    if (isCircuit) return 'circuits'
    if (isActivity) return 'XP'
    return 'sets'
  }

  const getProgressText = () => {
    if (isGym) return `${totalSets}/${targetSets} sets`
    if (isRun) return totalLogged > 0 ? `${totalLogged} km` : row.repsTimeText
    if (isCircuit) return totalLogged > 0 ? `${totalLogged} circuits` : row.setsText
    if (isActivity) return totalLogged > 0 ? `${totalLogged} XP` : row.repsTimeText
    return ''
  }

  const formatLogEntry = (log: LogEntry, index: number) => {
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
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-zinc-500">{getProgressText()}</span>

          {showInput ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={getInputPlaceholder()}
                className="w-14 bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-white text-sm text-center"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
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

      {/* Log individual set form for gym */}
      {showSetForm && isGym && (
        <div className="mt-3 pt-3 border-t border-zinc-700">
          <div className="text-xs text-zinc-400 mb-2">Log Set {totalSets + 1}</div>
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
                  onClick={() => onDeleteLog(log.id)}
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

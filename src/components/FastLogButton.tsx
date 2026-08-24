'use client'

import { useState } from 'react'
import { Plus, X, Dumbbell, Timer, Zap, Activity, RotateCcw } from 'lucide-react'
import { calculateXP, normalizeWorkoutType, type WorkoutType } from '@/lib/types'

interface QuickLogData {
  type: string
  exerciseOrActivity: string
  setsCompleted?: number
  reps?: number
  weight?: number
  km?: number
  circuitsCompleted?: number
  manualXP?: number
  notes?: string
}

interface FastLogButtonProps {
  onLog: (data: QuickLogData) => Promise<void>
}

// Raw form field values for one quick log. Persisted as-is to localStorage so
// the "Again: ..." shortcut can rebuild and resubmit the exact same log.
interface QuickLogFields {
  type: WorkoutType
  exercise: string
  sets: string
  reps: string
  weight: string
  km: string
  circuits: string
  xp: string
  notes: string
}

const STORAGE_KEY = 'pt:lastQuickLog'

function readLastQuickLog(): QuickLogFields | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Record<keyof QuickLogFields, unknown>>
    const type = normalizeWorkoutType(String(parsed.type ?? ''))
    if (!type) return null
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      type,
      exercise: str(parsed.exercise),
      sets: str(parsed.sets),
      reps: str(parsed.reps),
      weight: str(parsed.weight),
      km: str(parsed.km),
      circuits: str(parsed.circuits),
      xp: str(parsed.xp),
      notes: str(parsed.notes),
    }
  } catch {
    return null
  }
}

function saveLastQuickLog(fields: QuickLogFields) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
  } catch {
    // localStorage unavailable (private mode etc.) — quick-repeat just won't remember
  }
}

// Parse the string form fields into the onLog payload (same rules the old
// inline submit used: gym defaults to 1 set; other numbers only when present).
function buildLogData(f: QuickLogFields): QuickLogData {
  const data: QuickLogData = {
    type: f.type,
    exerciseOrActivity: f.exercise.trim() || f.type,
    notes: f.notes || undefined,
  }
  if (f.type === 'Gym') {
    data.setsCompleted = parseInt(f.sets) || 1
    if (f.reps) data.reps = parseInt(f.reps)
    if (f.weight) data.weight = parseFloat(f.weight)
  } else if (f.type === 'Run' && f.km) {
    data.km = parseFloat(f.km)
  } else if (f.type === 'Circuit' && f.circuits) {
    data.circuitsCompleted = parseInt(f.circuits)
  } else if (f.type === 'Activity' && f.xp) {
    data.manualXP = parseInt(f.xp)
  }
  return data
}

// Short human label for the quick-repeat chip, e.g. "Run 5 km" or "Bench 4x10 @ 50kg".
function describeQuickLog(f: QuickLogFields): string {
  const name = f.exercise.trim() || f.type
  if (f.type === 'Gym') {
    const setCount = parseInt(f.sets) || 1
    const detail = f.reps ? `${setCount}x${f.reps}` : `${setCount} set${setCount === 1 ? '' : 's'}`
    return `${name} ${detail}${f.weight ? ` @ ${f.weight}kg` : ''}`
  }
  if (f.type === 'Run') return f.km ? `${name} ${f.km} km` : name
  if (f.type === 'Circuit') return f.circuits ? `${name} ${f.circuits} circuits` : name
  return name
}

export function FastLogButton({ onLog }: FastLogButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [logType, setLogType] = useState<WorkoutType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLog, setLastLog] = useState<QuickLogFields | null>(null)

  // Form state (strings, parsed at submit)
  const [exercise, setExercise] = useState('')
  const [sets, setSets] = useState('')
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [km, setKm] = useState('')
  const [circuits, setCircuits] = useState('')
  const [xp, setXp] = useState('')
  const [notes, setNotes] = useState('')

  const currentFields: QuickLogFields | null = logType
    ? { type: logType, exercise, sets, reps, weight, km, circuits, xp, notes }
    : null
  const previewXP = currentFields ? calculateXP(currentFields.type, buildLogData(currentFields)) : 0

  const reset = () => {
    setLogType(null)
    setError(null)
    setExercise('')
    setSets('')
    setReps('')
    setWeight('')
    setKm('')
    setCircuits('')
    setXp('')
    setNotes('')
  }

  const handleOpen = () => {
    setLastLog(readLastQuickLog())
    setIsOpen(true)
  }

  const handleClose = () => {
    setIsOpen(false)
    reset()
  }

  // Shared submit path: on failure keep the sheet (and form values) open and
  // show an inline error; on success remember the log for quick-repeat.
  const submitLog = async (fields: QuickLogFields) => {
    setLoading(true)
    setError(null)
    try {
      await onLog(buildLogData(fields))
      saveLastQuickLog(fields)
      handleClose()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = () => {
    if (currentFields) void submitLog(currentFields)
  }

  const handleQuickRepeat = () => {
    if (lastLog) void submitLog(lastLog)
  }

  const typeButtons = [
    { key: 'Gym', icon: Dumbbell, color: 'bg-blue-600' },
    { key: 'Run', icon: Timer, color: 'bg-green-600' },
    { key: 'Circuit', icon: Zap, color: 'bg-orange-600' },
    { key: 'Activity', icon: Activity, color: 'bg-purple-600' },
  ] as const

  return (
    <>
      {/* FAB */}
      <button
        onClick={handleOpen}
        className="fixed bottom-24 right-4 w-16 h-16 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-95 z-40"
      >
        <Plus className="w-8 h-8" />
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center" onClick={handleClose}>
          <div
            className="bg-zinc-900 w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-4 pb-safe max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-white">
                {logType ? `Log ${logType}` : 'Quick Log'}
              </h2>
              <button onClick={handleClose} className="text-zinc-400 hover:text-white p-1">
                <X className="w-6 h-6" />
              </button>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-4">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {!logType ? (
              <div className="space-y-3">
                {lastLog && (
                  <button
                    onClick={handleQuickRepeat}
                    disabled={loading}
                    className="w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-3 flex items-center justify-center gap-2 font-medium active:scale-95 transition-transform disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    <span>
                      {loading
                        ? 'Logging...'
                        : `Again: ${describeQuickLog(lastLog)} (+${calculateXP(lastLog.type, buildLogData(lastLog))} XP)`}
                    </span>
                  </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {typeButtons.map(({ key, icon: Icon, color }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setError(null)
                        setLogType(key)
                      }}
                      disabled={loading}
                      className={`${color} text-white rounded-lg p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform disabled:opacity-50`}
                    >
                      <Icon className="w-8 h-8" />
                      <span className="font-medium">{key}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={reset}
                  className="text-zinc-400 hover:text-white text-sm"
                >
                  &larr; Back
                </button>

                <input
                  type="text"
                  placeholder="Exercise / Activity name (optional)"
                  value={exercise}
                  onChange={(e) => setExercise(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500"
                />

                {logType === 'Gym' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-zinc-400 text-xs mb-1">Sets</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="4"
                          value={sets}
                          onChange={(e) => setSets(e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-white text-xl text-center"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-400 text-xs mb-1">Reps</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="10"
                          value={reps}
                          onChange={(e) => setReps(e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-white text-xl text-center"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-400 text-xs mb-1">Weight (kg)</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          placeholder="50"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-white text-xl text-center"
                        />
                      </div>
                    </div>
                    <p className="text-zinc-500 text-sm text-center">= {previewXP} XP (1 XP per set)</p>
                  </div>
                )}

                {logType === 'Run' && (
                  <div>
                    <label className="block text-zinc-400 text-sm mb-1">Kilometers</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      placeholder="e.g., 5.0"
                      value={km}
                      onChange={(e) => setKm(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-2xl text-center"
                      autoFocus
                    />
                    <p className="text-zinc-500 text-sm mt-1">= {previewXP} XP</p>
                  </div>
                )}

                {logType === 'Circuit' && (
                  <div>
                    <label className="block text-zinc-400 text-sm mb-1">Circuits completed</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="e.g., 3"
                      value={circuits}
                      onChange={(e) => setCircuits(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-2xl text-center"
                      autoFocus
                    />
                    <p className="text-zinc-500 text-sm mt-1">= {previewXP} XP</p>
                  </div>
                )}

                {logType === 'Activity' && (
                  <div>
                    <label className="block text-zinc-400 text-sm mb-1">XP (manual entry)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="e.g., 10"
                      value={xp}
                      onChange={(e) => setXp(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-2xl text-center"
                      autoFocus
                    />
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500"
                />

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-700 text-white font-medium rounded-lg py-4 transition-colors"
                >
                  {loading ? 'Logging...' : 'Log'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

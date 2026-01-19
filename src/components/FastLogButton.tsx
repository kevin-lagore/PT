'use client'

import { useState } from 'react'
import { Plus, X, Dumbbell, Timer, Zap, Activity } from 'lucide-react'

interface FastLogButtonProps {
  onLog: (data: {
    type: string
    exerciseOrActivity: string
    setsCompleted?: number
    reps?: number
    weight?: number
    km?: number
    circuitsCompleted?: number
    manualXP?: number
    notes?: string
  }) => Promise<void>
}

export function FastLogButton({ onLog }: FastLogButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [logType, setLogType] = useState<'gym' | 'run' | 'circuit' | 'activity' | null>(null)
  const [loading, setLoading] = useState(false)

  // Form state
  const [exercise, setExercise] = useState('')
  const [sets, setSets] = useState('')
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [km, setKm] = useState('')
  const [circuits, setCircuits] = useState('')
  const [xp, setXp] = useState('')
  const [notes, setNotes] = useState('')

  const reset = () => {
    setLogType(null)
    setExercise('')
    setSets('')
    setReps('')
    setWeight('')
    setKm('')
    setCircuits('')
    setXp('')
    setNotes('')
  }

  const handleClose = () => {
    setIsOpen(false)
    reset()
  }

  const handleSubmit = async () => {
    if (!logType) return

    setLoading(true)
    try {
      const data: Parameters<typeof onLog>[0] = {
        type: logType.charAt(0).toUpperCase() + logType.slice(1),
        exerciseOrActivity: exercise || logType,
        notes: notes || undefined,
      }

      if (logType === 'gym') {
        data.setsCompleted = parseInt(sets) || 1
        if (reps) data.reps = parseInt(reps)
        if (weight) data.weight = parseFloat(weight)
      } else if (logType === 'run' && km) {
        data.km = parseFloat(km)
      } else if (logType === 'circuit' && circuits) {
        data.circuitsCompleted = parseInt(circuits)
      } else if (logType === 'activity' && xp) {
        data.manualXP = parseInt(xp)
      }

      await onLog(data)
      handleClose()
    } finally {
      setLoading(false)
    }
  }

  const typeButtons = [
    { key: 'gym', label: 'Gym', icon: Dumbbell, color: 'bg-blue-600' },
    { key: 'run', label: 'Run', icon: Timer, color: 'bg-green-600' },
    { key: 'circuit', label: 'Circuit', icon: Zap, color: 'bg-orange-600' },
    { key: 'activity', label: 'Activity', icon: Activity, color: 'bg-purple-600' },
  ] as const

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setIsOpen(true)}
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
                {logType ? `Log ${logType.charAt(0).toUpperCase() + logType.slice(1)}` : 'Quick Log'}
              </h2>
              <button onClick={handleClose} className="text-zinc-400 hover:text-white p-1">
                <X className="w-6 h-6" />
              </button>
            </div>

            {!logType ? (
              <div className="grid grid-cols-2 gap-3">
                {typeButtons.map(({ key, label, icon: Icon, color }) => (
                  <button
                    key={key}
                    onClick={() => setLogType(key)}
                    className={`${color} text-white rounded-lg p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform`}
                  >
                    <Icon className="w-8 h-8" />
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
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

                {logType === 'gym' && (
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
                    <p className="text-zinc-500 text-sm text-center">= {sets ? parseInt(sets) : 1} XP (1 XP per set)</p>
                  </div>
                )}

                {logType === 'run' && (
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
                    <p className="text-zinc-500 text-sm mt-1">= {km ? Math.round(parseFloat(km) * 3) : 0} XP</p>
                  </div>
                )}

                {logType === 'circuit' && (
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
                    <p className="text-zinc-500 text-sm mt-1">= {circuits ? parseInt(circuits) * 15 : 0} XP</p>
                  </div>
                )}

                {logType === 'activity' && (
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

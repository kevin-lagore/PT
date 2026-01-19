'use client'

import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'

interface WeekData {
  weekStart: string
  xp: number
  byType: Record<string, number>
}

export default function ProgressPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProgress()
  }, [])

  const fetchProgress = async () => {
    try {
      const res = await fetch('/api/progress')
      const data = await res.json()
      setWeeks(data.weeks)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  const maxXP = Math.max(...weeks.map(w => w.xp), 100)
  const totalXP = weeks.reduce((sum, w) => sum + w.xp, 0)

  // Aggregate XP by type across all weeks
  const xpByType: Record<string, number> = {}
  for (const week of weeks) {
    for (const [type, xp] of Object.entries(week.byType)) {
      xpByType[type] = (xpByType[type] || 0) + xp
    }
  }

  const typeColors: Record<string, string> = {
    gym: 'bg-blue-500',
    run: 'bg-green-500',
    circuit: 'bg-orange-500',
    activity: 'bg-purple-500',
  }

  const formatWeekLabel = (weekStart: string) => {
    const date = new Date(weekStart)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const handleExport = () => {
    window.location.href = '/api/export'
  }

  return (
    <div className="pb-24 px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">Progress</h1>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg text-sm font-medium active:scale-95 transition-transform"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Total XP */}
      <div className="bg-zinc-900 rounded-lg p-4 mb-6">
        <div className="text-zinc-400 text-sm">Total XP (8 weeks)</div>
        <div className="text-3xl font-bold text-emerald-400">{totalXP} XP</div>
      </div>

      {/* Weekly XP Chart */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Weekly XP</h2>
        <div className="bg-zinc-900 rounded-lg p-4">
          <div className="flex items-end justify-between gap-2 h-32">
            {weeks.map((week, i) => {
              const height = maxXP > 0 ? (week.xp / maxXP) * 100 : 0
              const isCurrentWeek = i === weeks.length - 1
              return (
                <div key={week.weekStart} className="flex-1 flex flex-col items-center">
                  <div className="text-xs text-zinc-500 mb-1">{week.xp}</div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isCurrentWeek ? 'bg-emerald-500' : 'bg-zinc-600'
                    }`}
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <div className="text-xs text-zinc-500 mt-2 whitespace-nowrap">
                    {formatWeekLabel(week.weekStart)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* XP by Type */}
      <div>
        <h2 className="text-sm font-medium text-zinc-400 mb-3">XP by Type</h2>
        <div className="bg-zinc-900 rounded-lg p-4 space-y-3">
          {Object.entries(xpByType).length === 0 ? (
            <p className="text-zinc-500 text-sm">No workouts logged yet</p>
          ) : (
            Object.entries(xpByType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, xp]) => {
                const percentage = totalXP > 0 ? (xp / totalXP) * 100 : 0
                return (
                  <div key={type}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-white capitalize">{type}</span>
                      <span className="text-zinc-400">{xp} XP</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${typeColors[type] || 'bg-zinc-500'} rounded-full transition-all`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'

interface WeekData {
  weekStart: string
  xp: number
  byType: Record<string, number>
}

interface DailyXP {
  date: string
  xp: number
}

interface RollingAverage {
  date: string
  avg7: number | null
  avg14: number | null
  avg28: number | null
}

function calculateRollingAverages(dailyXP: DailyXP[]): RollingAverage[] {
  return dailyXP.map((day, index) => {
    const get7 = index >= 6 ? dailyXP.slice(index - 6, index + 1).reduce((sum, d) => sum + d.xp, 0) / 7 : null
    const get14 = index >= 13 ? dailyXP.slice(index - 13, index + 1).reduce((sum, d) => sum + d.xp, 0) / 14 : null
    const get28 = index >= 27 ? dailyXP.slice(index - 27, index + 1).reduce((sum, d) => sum + d.xp, 0) / 28 : null
    return {
      date: day.date,
      avg7: get7,
      avg14: get14,
      avg28: get28
    }
  })
}

function RollingAverageChart({ dailyXP }: { dailyXP: DailyXP[] }) {
  const averages = calculateRollingAverages(dailyXP)
  // Only show last 32 days for the chart display
  const displayData = averages.slice(-32)
  const displayDailyXP = dailyXP.slice(-32)

  // Find max value for scaling (include daily XP values)
  const allAvgValues = displayData.flatMap(d => [d.avg7, d.avg14, d.avg28].filter((v): v is number => v !== null))
  const maxDailyXP = Math.max(...displayDailyXP.map(d => d.xp), 0)
  const maxVal = Math.max(...allAvgValues, maxDailyXP, 1)

  const chartHeight = 120
  const barWidth = 100 / displayData.length

  // Build SVG path for each line
  const buildPath = (key: 'avg7' | 'avg14' | 'avg28'): string => {
    const points: string[] = []
    displayData.forEach((d, i) => {
      const val = d[key]
      if (val !== null) {
        const x = (i / (displayData.length - 1)) * 100
        const y = chartHeight - (val / maxVal) * chartHeight
        points.push(`${points.length === 0 ? 'M' : 'L'} ${x} ${y}`)
      }
    })
    return points.join(' ')
  }

  const path7 = buildPath('avg7')
  const path14 = buildPath('avg14')
  const path28 = buildPath('avg28')

  // Date labels for x-axis
  const firstDate = displayData[0]?.date
  const lastDate = displayData[displayData.length - 1]?.date
  const formatLabel = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div>
      <svg
        viewBox={`0 0 100 ${chartHeight}`}
        preserveAspectRatio="none"
        className="w-full h-32"
        style={{ overflow: 'visible' }}
      >
        {/* Grid lines */}
        <line x1="0" y1={chartHeight * 0.25} x2="100" y2={chartHeight * 0.25} stroke="#3f3f46" strokeWidth="0.3" />
        <line x1="0" y1={chartHeight * 0.5} x2="100" y2={chartHeight * 0.5} stroke="#3f3f46" strokeWidth="0.3" />
        <line x1="0" y1={chartHeight * 0.75} x2="100" y2={chartHeight * 0.75} stroke="#3f3f46" strokeWidth="0.3" />

        {/* Daily XP bars */}
        {displayDailyXP.map((d, i) => {
          const barHeight = (d.xp / maxVal) * chartHeight
          const x = (i / displayData.length) * 100
          return (
            <rect
              key={d.date}
              x={x}
              y={chartHeight - barHeight}
              width={barWidth * 0.8}
              height={barHeight}
              fill="#3f3f46"
              rx="0.5"
            />
          )
        })}

        {/* Lines - 28 day first (back), then 14, then 7 (front) */}
        {path28 && (
          <path d={path28} fill="none" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {path14 && (
          <path d={path14} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {path7 && (
          <path d={path7} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between text-xs text-zinc-500 mt-1">
        <span>{firstDate ? formatLabel(firstDate) : ''}</span>
        <span>{lastDate ? formatLabel(lastDate) : ''}</span>
      </div>

      {/* Current values */}
      <div className="flex justify-center gap-4 mt-2 text-xs">
        {displayData.length > 0 && displayData[displayData.length - 1].avg7 !== null && (
          <span className="text-emerald-400">{displayData[displayData.length - 1].avg7!.toFixed(1)}</span>
        )}
        {displayData.length > 0 && displayData[displayData.length - 1].avg14 !== null && (
          <span className="text-blue-400">{displayData[displayData.length - 1].avg14!.toFixed(1)}</span>
        )}
        {displayData.length > 0 && displayData[displayData.length - 1].avg28 !== null && (
          <span className="text-orange-400">{displayData[displayData.length - 1].avg28!.toFixed(1)}</span>
        )}
      </div>
    </div>
  )
}

export default function ProgressPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([])
  const [dailyXP, setDailyXP] = useState<DailyXP[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProgress()
  }, [])

  const fetchProgress = async () => {
    try {
      const res = await fetch('/api/progress')
      const data = await res.json()
      setWeeks(data.weeks)
      setDailyXP(data.dailyXP || [])
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

      {/* Rolling Average Chart */}
      {dailyXP.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Daily XP Rolling Averages</h2>
          <div className="bg-zinc-900 rounded-lg p-4">
            <RollingAverageChart dailyXP={dailyXP} />
            <div className="flex justify-center gap-4 mt-3 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-emerald-400 rounded" />
                <span className="text-zinc-400">7-day</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-blue-400 rounded" />
                <span className="text-zinc-400">14-day</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-orange-400 rounded" />
                <span className="text-zinc-400">28-day</span>
              </div>
            </div>
          </div>
        </div>
      )}

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

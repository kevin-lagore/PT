'use client'

import { Flame } from 'lucide-react'
import { formatDate, getMonday } from '@/lib/types'

interface WeekGoalProps {
  sessionDays: string[]        // this week's distinct local yyyy-mm-dd dates with >= 1 log
  sessionGoal: number          // effective goal for this week (2/3/4, comeback ramp)
  streak: number
  comebackMode: boolean
  lastWorkoutDaysAgo: number | null
  todayStr: string             // client-local yyyy-mm-dd
}

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F']

// Weekly goal strip for the sticky header: five weekday dots (Mon-Fri),
// a "2 of 4 sessions" label and a streak pill. Weekend sessions still count
// toward the session total even though weekends never get a dot.
export function WeekGoal({
  sessionDays,
  sessionGoal,
  streak,
  comebackMode,
  lastWorkoutDaysAgo,
  todayStr,
}: WeekGoalProps) {
  // Local midnight — never new Date('yyyy-mm-dd'), which parses as UTC.
  const monday = getMonday(new Date(todayStr + 'T00:00:00'))
  const weekdayDates: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    weekdayDates.push(formatDate(d))
  }

  const count = sessionDays.length
  const complete = count >= sessionGoal

  const comebackTitle =
    lastWorkoutDaysAgo != null && lastWorkoutDaysAgo >= 14
      ? `First week back — goal is ${sessionGoal} sessions`
      : `Ramping back up — goal is ${sessionGoal} sessions`

  return (
    <div className="flex items-center justify-between mt-2">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mon-Fri dots */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {weekdayDates.map((date, i) => {
            const logged = sessionDays.includes(date)
            const isToday = date === todayStr
            let dotClass = 'bg-zinc-700'
            if (logged) {
              dotClass = complete
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                : 'bg-emerald-400'
            } else if (isToday) {
              dotClass = 'border-2 border-emerald-400 bg-transparent'
            }
            return (
              <span
                key={date}
                title={`${WEEKDAY_LABELS[i]} ${date}`}
                className={`w-3 h-3 rounded-full ${dotClass}`}
              />
            )
          })}
        </div>

        {/* Session count label */}
        {complete ? (
          <span className="text-sm font-medium text-emerald-400 truncate">Week complete!</span>
        ) : (
          <span className="text-sm text-zinc-400 truncate">
            {count} of {sessionGoal} sessions
          </span>
        )}

        {/* Comeback ramp chip */}
        {comebackMode && !complete && (
          <span
            title={comebackTitle}
            className="flex-shrink-0 text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full"
          >
            Comeback
          </span>
        )}
      </div>

      {/* Streak pill */}
      {streak > 0 && (
        <span className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">
          <Flame className="w-4 h-4" />
          Streak: {streak} wk{streak === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

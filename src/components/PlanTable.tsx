import { ParsedRow } from '@/lib/markdown-parser'

export interface PlanTableProps {
  rows: ParsedRow[]
}

// Shared 5-column plan table used by the Current Week display and the parse
// preview on the Plans page. Notes render as a muted second line under the
// Exercise cell — they carry load-bearing guidance (e.g. 'hard stop 45 min ->
// shower -> work'). Because blank Notes cells inherit the previous row's note,
// a note is only rendered when it differs from the row above, so each day's
// guidance appears once instead of repeating on every exercise row.
export function PlanTable({ rows }: PlanTableProps) {
  return (
    <div className="bg-zinc-900 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left p-2 text-zinc-400 font-medium">Day</th>
            <th className="text-left p-2 text-zinc-400 font-medium">Type</th>
            <th className="text-left p-2 text-zinc-400 font-medium">Exercise</th>
            <th className="text-left p-2 text-zinc-400 font-medium">Sets</th>
            <th className="text-left p-2 text-zinc-400 font-medium">Reps</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const showNotes = row.notes !== '' && row.notes !== rows[i - 1]?.notes
            return (
              <tr key={i} className="border-b border-zinc-800/50">
                <td className="p-2 text-white">{row.day}</td>
                <td className="p-2 text-zinc-300">{row.type}</td>
                <td className="p-2 text-zinc-300">
                  {row.exercise}
                  {showNotes && (
                    <div className="text-xs text-zinc-500">{row.notes}</div>
                  )}
                </td>
                <td className="p-2 text-zinc-300">{row.sets}</td>
                <td className="p-2 text-zinc-300">{row.repsTime}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

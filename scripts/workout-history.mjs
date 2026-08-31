#!/usr/bin/env node
// Workout-history report straight off the raw LogEntry/WeekPlan/PlanRow tables.
// Run from the repo root:  npm run history
//
// Connects to Turso when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set in the
// environment / .env, otherwise opens the local prisma/dev.db file directly.
// No prisma client involved — plain SQL via @libsql/client.

import 'dotenv/config'
import { createClient } from '@libsql/client'

const useTurso = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
const client = useTurso
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: 'file:prisma/dev.db' })

// ---------------------------------------------------------------------------
// Helpers (mirror src/lib/types.ts semantics without importing TS)
// ---------------------------------------------------------------------------

// Prisma stores DATETIME columns differently per driver (epoch-ms numbers,
// ISO strings, or 'YYYY-MM-DD HH:MM:SS' from CURRENT_TIMESTAMP) — accept all.
function toDate(value) {
  if (value == null) return null
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'bigint') return new Date(Number(value))
  const s = String(value)
  if (/^\d+$/.test(s)) return new Date(Number(s))
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

// LOCAL calendar date as yyyy-mm-dd (never toISOString — that shifts timezones).
function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function dayName(date) {
  return WEEKDAYS[date.getDay()]
}

// Same canonical key as normalizeExerciseName in src/lib/types.ts.
function normalizeExercise(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

function kg(value) {
  return value == null ? '-' : `${Math.round(value * 10) / 10}kg`
}

function heading(text) {
  console.log('')
  console.log(text)
  console.log('-'.repeat(text.length))
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)))
  const line = cols => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  console.log(line(headers))
  console.log(widths.map(w => '='.repeat(w)).join('  '))
  for (const row of rows) console.log(line(row))
}

// One set's worth of detail for a log entry; entries with setsCompleted > 1
// count as that many identical sets (matches the app's expansion rule).
function describeEntry(entry) {
  const t = entry.type.toLowerCase()
  if (t.startsWith('gym')) {
    const one = entry.reps != null && entry.weight != null
      ? `${entry.reps}x${Math.round(entry.weight * 10) / 10}kg`
      : entry.reps != null
        ? `${entry.reps} reps`
        : '1 set'
    const count = entry.setsCompleted != null && entry.setsCompleted > 1 ? entry.setsCompleted : 1
    return Array(count).fill(one).join(', ')
  }
  if (t.startsWith('run') && entry.km != null) return `${entry.km} km`
  if (t.includes('circuit') && entry.circuitsCompleted != null) return `${entry.circuitsCompleted} circuit(s)`
  return `${entry.xp} XP`
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function main() {
  console.log(`WORKOUT HISTORY  (${useTurso ? 'Turso' : 'local prisma/dev.db'})`)

  let logResult, planResult
  try {
    logResult = await client.execute(
      'SELECT "date", "type", "exerciseOrActivity", "setsCompleted", "reps", "weight", "km", "circuitsCompleted", "xp", "createdAt" ' +
      'FROM "LogEntry" ORDER BY "createdAt" ASC'
    )
    planResult = await client.execute(
      'SELECT w."weekStartDate" AS weekStartDate, COUNT(p."id") AS rowCount ' +
      'FROM "WeekPlan" w LEFT JOIN "PlanRow" p ON p."weekPlanId" = w."id" ' +
      'GROUP BY w."id" ORDER BY w."weekStartDate" DESC LIMIT 8'
    )
  } catch (err) {
    console.error(`\nCould not read the database: ${err.message}`)
    console.error(useTurso
      ? 'Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.'
      : 'Expected prisma/dev.db with migrated tables — run this from the repo root.')
    process.exitCode = 1
    return
  }

  const logs = logResult.rows
    .map(r => ({
      date: toDate(r.date),
      type: String(r.type ?? ''),
      exercise: String(r.exerciseOrActivity ?? ''),
      setsCompleted: r.setsCompleted == null ? null : Number(r.setsCompleted),
      reps: r.reps == null ? null : Number(r.reps),
      weight: r.weight == null ? null : Number(r.weight),
      km: r.km == null ? null : Number(r.km),
      circuitsCompleted: r.circuitsCompleted == null ? null : Number(r.circuitsCompleted),
      xp: Number(r.xp ?? 0),
      createdAt: toDate(r.createdAt) ?? new Date(0)
    }))
    .filter(l => l.date != null)

  if (logs.length === 0) {
    console.log('\nNo workouts logged yet.')
  } else {
    const days = [...new Set(logs.map(l => ymd(l.date)))].sort()

    heading('Totals')
    console.log(`Logs:         ${logs.length}`)
    console.log(`Session days: ${days.length}`)
    console.log(`Date range:   ${days[0]} .. ${days[days.length - 1]}`)

    // ---- per-exercise summary, sorted by session count --------------------
    const byExercise = new Map()
    for (const log of logs) {
      const key = normalizeExercise(log.exercise)
      let agg = byExercise.get(key)
      if (!agg) {
        agg = { name: log.exercise, type: log.type, days: new Set(), lastDone: '', maxWeight: null, bestE1RM: null, maxKm: null }
        byExercise.set(key, agg)
      }
      const day = ymd(log.date)
      agg.days.add(day)
      if (day >= agg.lastDone) {
        agg.lastDone = day
        agg.name = log.exercise // display the most recent spelling
        agg.type = log.type
      }
      if (log.weight != null && (agg.maxWeight == null || log.weight > agg.maxWeight)) agg.maxWeight = log.weight
      if (log.weight != null && log.reps != null) {
        const e1rm = log.weight * (1 + log.reps / 30) // Epley
        if (agg.bestE1RM == null || e1rm > agg.bestE1RM) agg.bestE1RM = e1rm
      }
      if (log.km != null && (agg.maxKm == null || log.km > agg.maxKm)) agg.maxKm = log.km
    }

    const summary = [...byExercise.values()].sort(
      (a, b) => b.days.size - a.days.size || (a.lastDone < b.lastDone ? 1 : -1)
    )

    heading('Exercises')
    printTable(
      ['Exercise', 'Type', 'Sessions', 'Last done', 'Max weight', 'Best e1RM', 'Max km'],
      summary.map(agg => [
        agg.name,
        agg.type,
        agg.days.size,
        agg.lastDone,
        kg(agg.maxWeight),
        kg(agg.bestE1RM),
        agg.maxKm == null ? '-' : `${agg.maxKm} km`
      ])
    )

    // ---- last 3 sessions in detail ----------------------------------------
    heading('Last 3 sessions')
    for (const day of days.slice(-3).reverse()) {
      const dayLogs = logs
        .filter(l => ymd(l.date) === day)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      console.log(`${day} (${dayName(dayLogs[0].date)})`)
      for (const log of dayLogs) {
        console.log(`  ${log.exercise} [${log.type}]: ${describeEntry(log)}`)
      }
    }
  }

  // ---- recent week plans ---------------------------------------------------
  heading('Recent week plans')
  if (planResult.rows.length === 0) {
    console.log('No week plans saved yet.')
  } else {
    for (const row of planResult.rows) {
      const start = toDate(row.weekStartDate)
      console.log(`Week of ${start ? ymd(start) : String(row.weekStartDate)}  (${Number(row.rowCount)} rows)`)
    }
  }
}

try {
  await main()
} finally {
  client.close()
}

export interface ParsedRow {
  day: string
  type: string
  notes: string
  exercise: string
  sets: string
  repsTime: string
}

export interface ParseResult {
  success: boolean
  rows: ParsedRow[]
  errors: string[]
}

const EXPECTED_HEADERS = ['Day', 'Type', 'Notes', 'Exercise / Activity', 'Sets', 'Reps / Time']

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isAlignmentRow(row: string): boolean {
  // Matches rows like |---|---|---| or | --- | --- |
  return /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(row)
}

function parseCells(row: string): string[] {
  // Remove leading/trailing pipes and split
  let cleaned = row.trim()
  if (cleaned.startsWith('|')) cleaned = cleaned.slice(1)
  if (cleaned.endsWith('|')) cleaned = cleaned.slice(0, -1)

  return cleaned.split('|').map(cell => cell.trim())
}

export function parseMarkdownTable(markdown: string): ParseResult {
  const errors: string[] = []
  const rows: ParsedRow[] = []

  // Split into lines and filter empty ones
  const lines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (lines.length === 0) {
    return { success: false, rows: [], errors: ['No content provided'] }
  }

  // Find header row (first non-empty line with pipes)
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|') && !isAlignmentRow(lines[i])) {
      headerIndex = i
      break
    }
  }

  if (headerIndex === -1) {
    return { success: false, rows: [], errors: ['No header row found'] }
  }

  // Validate headers
  const headerCells = parseCells(lines[headerIndex])
  const normalizedExpected = EXPECTED_HEADERS.map(normalizeHeader)

  if (headerCells.length !== EXPECTED_HEADERS.length) {
    return {
      success: false,
      rows: [],
      errors: [`Expected ${EXPECTED_HEADERS.length} columns, found ${headerCells.length}`]
    }
  }

  for (let i = 0; i < headerCells.length; i++) {
    const normalizedActual = normalizeHeader(headerCells[i])
    if (normalizedActual !== normalizedExpected[i]) {
      errors.push(`Column ${i + 1}: expected '${EXPECTED_HEADERS[i]}', found '${headerCells[i]}'`)
    }
  }

  if (errors.length > 0) {
    return { success: false, rows: [], errors }
  }

  // Parse data rows
  let previousRow: ParsedRow | null = null
  let dataRowNumber = 0

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    // Skip alignment rows
    if (isAlignmentRow(line)) continue

    // Skip if line doesn't look like a table row
    if (!line.includes('|')) continue

    dataRowNumber++
    const cells = parseCells(line)

    // Pad with empty strings if needed
    while (cells.length < 6) cells.push('')

    // Apply inheritance
    const row: ParsedRow = {
      day: cells[0] || (previousRow?.day ?? ''),
      type: cells[1] || (previousRow?.type ?? ''),
      notes: cells[2] || (previousRow?.notes ?? ''),
      exercise: cells[3] || (previousRow?.exercise ?? ''),
      sets: cells[4] || (previousRow?.sets ?? ''),
      repsTime: cells[5] || (previousRow?.repsTime ?? ''),
    }

    // Validate first row has all values
    if (dataRowNumber === 1) {
      if (!row.day) errors.push('Row 1: Day is required in the first row')
      if (!row.type) errors.push('Row 1: Type is required in the first row')
      if (!row.notes) errors.push('Row 1: Notes is required in the first row')
      if (!row.exercise) errors.push('Row 1: Exercise / Activity is required in the first row')
      if (!row.sets) errors.push('Row 1: Sets is required in the first row')
      if (!row.repsTime) errors.push('Row 1: Reps / Time is required in the first row')
    } else {
      // Validate inheritance worked
      if (!row.day) errors.push(`Row ${dataRowNumber}: missing Day value and cannot inherit`)
      if (!row.type) errors.push(`Row ${dataRowNumber}: missing Type value and cannot inherit`)
      if (!row.notes) errors.push(`Row ${dataRowNumber}: missing Notes value and cannot inherit`)
      if (!row.exercise) errors.push(`Row ${dataRowNumber}: missing Exercise / Activity value and cannot inherit`)
      if (!row.sets) errors.push(`Row ${dataRowNumber}: missing Sets value and cannot inherit`)
      if (!row.repsTime) errors.push(`Row ${dataRowNumber}: missing Reps / Time value and cannot inherit`)
    }

    rows.push(row)
    previousRow = row
  }

  if (rows.length === 0) {
    errors.push('No data rows found')
  }

  return {
    success: errors.length === 0,
    rows: errors.length === 0 ? rows : [],
    errors
  }
}

export function rowsToMarkdown(rows: ParsedRow[]): string {
  const lines: string[] = []

  // Header
  lines.push('| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |')
  lines.push('|-----|------|-------|---------------------|------|-------------|')

  // Data rows
  for (const row of rows) {
    lines.push(`| ${row.day} | ${row.type} | ${row.notes} | ${row.exercise} | ${row.sets} | ${row.repsTime} |`)
  }

  return lines.join('\n')
}

export function rowsToCSV(rows: ParsedRow[]): string {
  const lines: string[] = []

  // Header
  lines.push('Day,Type,Notes,Exercise / Activity,Sets,Reps / Time')

  // Data rows - escape commas and quotes
  for (const row of rows) {
    const cells = [row.day, row.type, row.notes, row.exercise, row.sets, row.repsTime]
    const escaped = cells.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`
      }
      return cell
    })
    lines.push(escaped.join(','))
  }

  return lines.join('\n')
}

export const EXAMPLE_PLAN = `| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Push Day - 60kg bench | Bench Press | 4 | 8-10 |
| | | 40kg | Overhead Press | 3 | 8-12 |
| | | 20kg each | Dumbbell Incline Press | 3 | 10-12 |
| | | 15kg each | Lateral Raises | 3 | 12-15 |
| | | Bodyweight | Tricep Dips | 3 | 10-15 |
| Tuesday | Run | Easy pace | Steady Run | 1 | 5 km |
| Wednesday | Gym | Pull Day - 80kg | Deadlift | 4 | 6-8 |
| | | 60kg | Barbell Row | 4 | 8-10 |
| | | Bodyweight | Pull-ups | 3 | 8-12 |
| | | 12kg each | Dumbbell Curls | 3 | 10-12 |
| | | 10kg | Face Pulls | 3 | 15-20 |
| Thursday | Run | Speed work | Intervals | 1 | 8x400m |
| Friday | Gym | Legs - 80kg | Squat | 4 | 8-10 |
| | | 60kg | Romanian Deadlift | 3 | 10-12 |
| | | 40kg | Walking Lunges | 3 | 12 each |
| | | 60kg | Leg Press | 3 | 12-15 |
| | | Bodyweight | Calf Raises | 4 | 15-20 |
| Saturday | Circuit | Full body circuit | Circuit A | 3 | 15 min |
| | | Core focus | Circuit B | 2 | 10 min |
| Sunday | Activity | Active recovery | Walk/Stretch | 1 | 30 min |`

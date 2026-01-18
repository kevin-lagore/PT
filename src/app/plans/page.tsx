'use client'

import { useState, useEffect } from 'react'
import { parseMarkdownTable, rowsToMarkdown, rowsToCSV, EXAMPLE_PLAN, ParsedRow } from '@/lib/markdown-parser'
import { Copy, Check, Download, Upload, FileText } from 'lucide-react'

export default function PlansPage() {
  const [markdown, setMarkdown] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<ParsedRow[] | null>(null)

  useEffect(() => {
    fetchCurrentPlan()
  }, [])

  const fetchCurrentPlan = async () => {
    const res = await fetch('/api/plans')
    const plan = await res.json()
    if (plan?.rows) {
      const rows: ParsedRow[] = plan.rows.map((r: {
        day: string
        type: string
        notes: string
        exercise: string
        setsText: string
        repsTimeText: string
      }) => ({
        day: r.day,
        type: r.type,
        notes: r.notes,
        exercise: r.exercise,
        sets: r.setsText,
        repsTime: r.repsTimeText,
      }))
      setCurrentPlan(rows)
    }
  }

  const handleParse = () => {
    const result = parseMarkdownTable(markdown)
    if (result.success) {
      setPreview(result.rows)
      setErrors([])
    } else {
      setPreview([])
      setErrors(result.errors)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      })

      if (res.ok) {
        setSaved(true)
        setPreview([])
        setMarkdown('')
        fetchCurrentPlan()
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        setErrors(data.errors || ['Failed to save plan'])
      }
    } finally {
      setSaving(false)
    }
  }

  const handleCopyMarkdown = async () => {
    if (currentPlan) {
      await navigator.clipboard.writeText(rowsToMarkdown(currentPlan))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleExportCSV = () => {
    if (currentPlan) {
      const csv = rowsToCSV(currentPlan)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'workout-plan.csv'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleLoadExample = () => {
    setMarkdown(EXAMPLE_PLAN)
  }

  return (
    <div className="pb-24 px-4 py-4">
      <h1 className="text-xl font-bold text-white mb-4">Weekly Plan</h1>

      {/* Current plan display */}
      {currentPlan && currentPlan.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-zinc-400">Current Week</h2>
            <div className="flex gap-2">
              <button
                onClick={handleCopyMarkdown}
                className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy MD'}
              </button>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
          </div>

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
                {currentPlan.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="p-2 text-white">{row.day}</td>
                    <td className="p-2 text-zinc-300">{row.type}</td>
                    <td className="p-2 text-zinc-300">{row.exercise}</td>
                    <td className="p-2 text-zinc-300">{row.sets}</td>
                    <td className="p-2 text-zinc-300">{row.repsTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paste area */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">
            {currentPlan ? 'Replace Plan' : 'Create Plan'}
          </h2>
          <button
            onClick={handleLoadExample}
            className="flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
          >
            <FileText className="w-4 h-4" />
            Load Example
          </button>
        </div>

        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder="Paste Markdown table here...

| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Push - 60kg | Bench Press | 4 | 8-10 |"
          className="w-full h-48 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white placeholder-zinc-600 text-sm font-mono resize-none"
        />

        <button
          onClick={handleParse}
          disabled={!markdown.trim()}
          className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-white font-medium py-3 rounded-lg transition-colors"
        >
          Parse & Preview
        </button>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-3">
            <p className="text-red-400 font-medium text-sm mb-2">Parsing errors:</p>
            <ul className="text-red-300 text-sm space-y-1">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-400">Preview</h3>
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
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b border-zinc-800/50">
                      <td className="p-2 text-white">{row.day}</td>
                      <td className="p-2 text-zinc-300">{row.type}</td>
                      <td className="p-2 text-zinc-300">{row.exercise}</td>
                      <td className="p-2 text-zinc-300">{row.sets}</td>
                      <td className="p-2 text-zinc-300">{row.repsTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Week'}
            </button>
          </div>
        )}

        {/* CSV Import */}
        <div className="pt-4 border-t border-zinc-800">
          <label className="flex items-center justify-center gap-2 text-sm text-zinc-400 hover:text-white cursor-pointer py-3 border border-dashed border-zinc-700 rounded-lg hover:border-zinc-500 transition-colors">
            <Upload className="w-4 h-4" />
            Import CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) {
                  const text = await file.text()
                  // Convert CSV to markdown
                  const lines = text.split('\n').filter(l => l.trim())
                  const mdLines = lines.map(line => {
                    const cells = line.split(',').map(c => c.replace(/^"|"$/g, '').trim())
                    return `| ${cells.join(' | ')} |`
                  })
                  // Insert alignment row after header
                  mdLines.splice(1, 0, '|-----|------|-------|---------------------|------|-------------|')
                  setMarkdown(mdLines.join('\n'))
                }
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

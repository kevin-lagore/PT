'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseMarkdownTable, rowsToMarkdown, rowsToCSV, EXAMPLE_PLAN, ParsedRow } from '@/lib/markdown-parser'
import { TEMPLATES, WeekTemplate } from '@/lib/templates'
import { PlanTable } from '@/components/PlanTable'
import { Copy, Check, Download, Upload, FileText, RotateCcw } from 'lucide-react'

// Distinct session days per template, derived by actually parsing each
// template's markdown (computed once at module load).
const TEMPLATE_SESSION_COUNTS: Record<string, number> = Object.fromEntries(
  TEMPLATES.map((t) => {
    const result = parseMarkdownTable(t.markdown)
    return [t.id, new Set(result.rows.map((r) => r.day)).size]
  })
)

// Next 16: a client component calling useSearchParams must render inside a
// Suspense boundary or the production build fails. The default export is a
// thin Suspense wrapper around the real page content.
export default function PlansPage() {
  return (
    <Suspense
      fallback={
        <div className="pb-24 px-4 py-4">
          <h1 className="text-xl font-bold text-white mb-4">Weekly Plan</h1>
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      }
    >
      <PlansPageContent />
    </Suspense>
  )
}

function PlansPageContent() {
  const searchParams = useSearchParams()

  const [markdown, setMarkdown] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [repeating, setRepeating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<ParsedRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  const previewRef = useRef<HTMLDivElement | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedDeepLink = useRef(false)

  const fetchCurrentPlan = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/plans')
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
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
      } else {
        setCurrentPlan(null)
      }
    } catch {
      setLoadError('Failed to load the current plan. Check your connection and reload.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCurrentPlan()
  }, [fetchCurrentPlan])

  // Cleanup the success-banner timer on unmount
  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current)
    }
  }, [])

  const showSuccess = useCallback((message: string) => {
    setSuccess(message)
    if (successTimer.current) clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccess(null), 2500)
    // The banner lives at the top of the page; make sure it's visible.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const runParse = useCallback((md: string): boolean => {
    const result = parseMarkdownTable(md)
    if (result.success) {
      setPreview(result.rows)
      setErrors([])
    } else {
      setPreview([])
      setErrors(result.errors)
    }
    return result.success
  }, [])

  const applyTemplate = useCallback(
    (template: WeekTemplate) => {
      setMarkdown(template.markdown)
      setSelectedTemplate(template.id)
      runParse(template.markdown)
      // Wait a tick for the preview to render, then bring it into view so
      // Save Week is one more tap.
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    },
    [runParse]
  )

  // Deep link: /plans?template=comeback-week
  useEffect(() => {
    if (appliedDeepLink.current) return
    const id = searchParams.get('template')
    if (!id) return
    const template = TEMPLATES.find((t) => t.id === id)
    if (template) {
      appliedDeepLink.current = true
      applyTemplate(template)
    }
  }, [searchParams, applyTemplate])

  const handleParse = () => {
    runParse(markdown)
  }

  // Overwrite guard: the GET /api/plans rows don't include logEntries, so
  // confirm whenever a plan already exists for the displayed week. Fails
  // CLOSED while the current plan is unknown (still loading, or the fetch
  // errored) — a deep-linked template save can otherwise race the GET and
  // silently replace a live week.
  const confirmReplace = (): boolean => {
    if (loading || loadError) {
      return window.confirm(
        "Couldn't verify this week's plan yet — saving may replace an existing plan. Continue?"
      )
    }
    if (currentPlan && currentPlan.length > 0) {
      return window.confirm(
        'Replace this week’s plan? Logged workouts are kept but unlink from replaced rows.'
      )
    }
    return true
  }

  const handleSave = async () => {
    if (!confirmReplace()) return
    setSaving(true)
    setErrors([])
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      })

      if (res.ok) {
        setPreview([])
        setMarkdown('')
        setSelectedTemplate(null)
        showSuccess('Week plan saved')
        await fetchCurrentPlan()
      } else {
        const data = await res.json().catch(() => null)
        setErrors(data?.errors || ['Failed to save plan'])
      }
    } catch {
      setErrors(['Network error — could not save the plan'])
    } finally {
      setSaving(false)
    }
  }

  const handleRepeatLastWeek = async () => {
    if (!confirmReplace()) return
    setRepeating(true)
    setErrors([])
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyFromWeek: 'last' }),
      })

      if (res.ok) {
        showSuccess('Copied last week’s plan')
        await fetchCurrentPlan()
      } else {
        const data = await res.json().catch(() => null)
        setErrors(data?.errors || ['Failed to copy last week’s plan'])
      }
    } catch {
      setErrors(['Network error — could not copy last week’s plan'])
    } finally {
      setRepeating(false)
    }
  }

  const handleCopyMarkdown = async () => {
    if (currentPlan) {
      try {
        await navigator.clipboard.writeText(rowsToMarkdown(currentPlan))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard unavailable (permissions/insecure context) — ignore.
      }
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
    setSelectedTemplate(null)
  }

  return (
    <div className="pb-24 px-4 py-4">
      <h1 className="text-xl font-bold text-white mb-4">Weekly Plan</h1>

      {/* Success banner */}
      {success && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/40 rounded-lg p-3">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-emerald-400 text-sm font-medium">{success}</p>
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="mb-4 bg-red-900/30 border border-red-800 rounded-lg p-3">
          <p className="text-red-400 font-medium text-sm mb-1">Something went wrong</p>
          <p className="text-red-300 text-sm">{loadError}</p>
        </div>
      )}

      {/* Current plan display */}
      {loading ? (
        <p className="text-sm text-zinc-500 mb-6">Loading plan...</p>
      ) : (
        currentPlan &&
        currentPlan.length > 0 && (
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

            <PlanTable rows={currentPlan} />
          </div>
        )
      )}

      {/* Templates — the primary path */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-2">Start from a template</h2>
        <div className="grid gap-2">
          {TEMPLATES.map((template) => {
            const isSelected = selectedTemplate === template.id
            return (
              <button
                key={template.id}
                onClick={() => applyTemplate(template)}
                className={`text-left rounded-lg p-3 border transition active:scale-95 ${
                  isSelected
                    ? 'bg-emerald-500/10 border-emerald-500'
                    : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{template.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {TEMPLATE_SESSION_COUNTS[template.id]} mornings
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{template.description}</p>
              </button>
            )
          })}
        </div>

        {/* Repeat last week — only when the current week has no plan yet */}
        {!loading && (!currentPlan || currentPlan.length === 0) && (
          <button
            onClick={handleRepeatLastWeek}
            disabled={repeating}
            className="mt-2 w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 border border-zinc-700 text-white font-medium py-3 rounded-lg transition active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            {repeating ? 'Copying...' : 'Repeat last week'}
          </button>
        )}
      </div>

      {/* Paste area — demoted, advanced path */}
      <div className="space-y-4 pt-4 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-500">Paste a plan (advanced)</h2>
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
          onChange={(e) => {
            setMarkdown(e.target.value)
            setSelectedTemplate(null)
          }}
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
          Parse &amp; Preview
        </button>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-3">
            <p className="text-red-400 font-medium text-sm mb-2">Errors:</p>
            <ul className="text-red-300 text-sm space-y-1">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <div ref={previewRef} className="space-y-3 scroll-mt-4">
            <h3 className="text-sm font-medium text-zinc-400">Preview</h3>
            <PlanTable rows={preview} />

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-700 text-white font-medium py-3 rounded-lg transition-colors active:scale-95"
            >
              {saving ? 'Saving...' : 'Save Week'}
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
                  const lines = text.split('\n').filter((l) => l.trim())
                  const mdLines = lines.map((line) => {
                    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim())
                    return `| ${cells.join(' | ')} |`
                  })
                  // Insert alignment row after header
                  mdLines.splice(1, 0, '|-----|------|-------|---------------------|------|-------------|')
                  setMarkdown(mdLines.join('\n'))
                  setSelectedTemplate(null)
                }
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

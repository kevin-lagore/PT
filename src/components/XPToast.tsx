'use client'

import { useEffect, useRef, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { ToastMessage } from '@/lib/types'

interface XPToastProps {
  toast: ToastMessage | null
  onDone: () => void
  onAction?: () => void
}

// Auto-dismiss duration per toast kind (ms).
const DURATIONS: Record<ToastMessage['kind'], number> = {
  xp: 2000,
  pr: 3000,
  error: 3000,
  action: 4000,
}

const PILL_CLASSES: Record<ToastMessage['kind'], string> = {
  xp: 'bg-emerald-500 text-white',
  pr: 'bg-amber-500 text-zinc-950',
  error: 'bg-red-900/90 border border-red-800 text-red-300',
  action: 'bg-zinc-800 border border-zinc-700 text-white',
}

export function XPToast({ toast, onDone, onAction }: XPToastProps) {
  const [visible, setVisible] = useState(false)

  // onDone lives in a ref so parent re-renders (which recreate inline callbacks)
  // never restart the timer — the cycle is keyed on the toast object alone.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  // Keyed on the toast object's identity: a new toast object (even with equal
  // contents) restarts the show/auto-dismiss cycle.
  useEffect(() => {
    if (toast === null) return
    setVisible(true)
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      setVisible(false)
      fadeTimer = setTimeout(() => onDoneRef.current(), 300)
    }, DURATIONS[toast.kind])
    return () => {
      clearTimeout(timer)
      if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    }
  }, [toast])

  if (toast === null) return null

  const handleAction = () => {
    onAction?.()
    setVisible(false)
    setTimeout(onDone, 300)
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] px-6 py-3 rounded-full shadow-lg font-semibold transition-all duration-300 z-50 ${
        PILL_CLASSES[toast.kind]
      } ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}
    >
      {toast.kind === 'xp' && <>Logged +{toast.xp ?? 0} XP</>}

      {toast.kind === 'pr' && (
        <span className="flex items-center gap-2">
          <Trophy className="w-5 h-5 shrink-0" />
          <span>{toast.message}</span>
          {toast.xp !== undefined && <span className="whitespace-nowrap">+{toast.xp} XP</span>}
        </span>
      )}

      {toast.kind === 'error' && <>{toast.message}</>}

      {toast.kind === 'action' && (
        <span className="flex items-center gap-3">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              onClick={handleAction}
              className="text-emerald-400 font-semibold active:scale-95 transition-transform"
            >
              {toast.actionLabel}
            </button>
          )}
        </span>
      )}
    </div>
  )
}

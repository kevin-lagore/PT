'use client'

import { useEffect, useState } from 'react'

interface XPToastProps {
  xp: number | null
  onDone: () => void
}

export function XPToast({ xp, onDone }: XPToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (xp !== null) {
      setVisible(true)
      const timer = setTimeout(() => {
        setVisible(false)
        setTimeout(onDone, 300)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [xp, onDone])

  if (xp === null) return null

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-6 py-3 rounded-full shadow-lg font-semibold transition-all duration-300 z-50 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      Logged +{xp} XP
    </div>
  )
}

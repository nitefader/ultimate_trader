import { useEffect, useState } from 'react'

export function usePollingGate(): boolean {
  const [paused, setPaused] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  )

  useEffect(() => {
    const syncVisibility = () => {
      setPaused(document.visibilityState === 'hidden')
    }

    document.addEventListener('visibilitychange', syncVisibility)

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  return paused
}

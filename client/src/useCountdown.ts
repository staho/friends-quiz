import { useEffect, useState } from "react"

/**
 * Milliseconds until the whole-second value `ceil(left / 1000)` changes, where
 * `left = remainingMs - elapsedMs`. Zero when nothing is left.
 */
export function nextBoundaryDelay(remainingMs: number, elapsedMs: number): number {
  const left = remainingMs - elapsedMs
  if (left <= 0) return 0
  const seconds = Math.ceil(left / 1000)
  return left - (seconds - 1) * 1000
}

/** Counts down from `remainingMs`; re-renders once per whole second, not per frame. Returns ms. */
export function useCountdown(remainingMs: number | null, active: boolean): number {
  const [left, setLeft] = useState(remainingMs ?? 0)
  const [stamp, setStamp] = useState({ remainingMs, active })
  if (stamp.remainingMs !== remainingMs || stamp.active !== active) {
    setStamp({ remainingMs, active })
    setLeft(remainingMs ?? 0)
  }

  useEffect(() => {
    if (remainingMs == null) {
      setLeft(0)
      return
    }
    const started = performance.now()
    setLeft(remainingMs)
    if (!active) return
    let timer = 0
    const tick = () => {
      const elapsed = performance.now() - started
      setLeft(Math.max(0, remainingMs - elapsed))
      const delay = nextBoundaryDelay(remainingMs, elapsed)
      if (delay > 0) timer = window.setTimeout(tick, delay + 2)
    }
    const first = nextBoundaryDelay(remainingMs, 0)
    if (first > 0) timer = window.setTimeout(tick, first + 2)
    return () => window.clearTimeout(timer)
  }, [remainingMs, active])

  return left
}

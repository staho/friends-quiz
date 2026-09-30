import { useEffect, useState } from "react"

export function useCountdown(remainingMs: number | null, active: boolean): number {
  const [left, setLeft] = useState(remainingMs ?? 0)

  useEffect(() => {
    if (remainingMs == null) {
      setLeft(0)
      return
    }
    const started = performance.now()
    setLeft(remainingMs)
    if (!active) return
    let frame = 0
    const tick = () => {
      setLeft(Math.max(0, remainingMs - (performance.now() - started)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [remainingMs, active])

  return left
}

import { useEffect } from "react"

type Sentinel = { release(): Promise<void> }

/** Keeps the screen on while mounted. Silently does nothing where the Wake Lock API is missing (plain http on a LAN). */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return
    let sentinel: Sentinel | null = null
    let active = true
    const request = async () => {
      try {
        const next = (await (navigator as Navigator & { wakeLock: { request(type: "screen"): Promise<Sentinel> } }).wakeLock.request("screen")) as Sentinel
        if (!active) {
          void next.release().catch(() => undefined)
          return
        }
        sentinel = next
      } catch {
        // Not allowed or not supported: fine.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void request()
    }
    void request()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisible)
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }
  }, [enabled])
}

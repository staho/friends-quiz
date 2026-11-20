import { useEffect, useRef } from "react"
import type { RoomSnapshot } from "@shared/types"

const NATIVE = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY", "A"])

interface Actions {
  snapshot: RoomSnapshot | null
  busy: boolean
  onStart: () => void
  onNext: () => void
  onPause: () => void
}

/**
 * Remote and keyboard control of the TV: Enter, right arrow and Page Down do the main action
 * (Start in the lobby, Next on a reveal); Space pauses an automatic reveal. Focusable controls keep
 * their own activation, so those targets are ignored.
 */
export function useHostKeys(actions: Actions): void {
  const latest = useRef(actions)
  latest.current = actions

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (target instanceof HTMLElement && (NATIVE.has(target.tagName) || target.isContentEditable)) return
      const { snapshot, busy, onStart, onNext, onPause } = latest.current
      if (!snapshot || busy) return
      if (event.key === "Enter" || event.key === "ArrowRight" || event.key === "PageDown") {
        if (snapshot.phase === "lobby" && snapshot.players.length > 0) {
          event.preventDefault()
          onStart()
        } else if (snapshot.phase === "reveal") {
          event.preventDefault()
          onNext()
        }
      } else if (event.code === "Space" && snapshot.phase === "reveal" && snapshot.settings.autoAdvance) {
        event.preventDefault()
        onPause()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

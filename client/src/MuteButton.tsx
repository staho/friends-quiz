import { useEffect, useState } from "react"
import { onMuteChange, readMuted, writeMuted } from "./sound"

export function MuteButton() {
  const [muted, setMuted] = useState(readMuted)

  useEffect(() => onMuteChange(() => setMuted(readMuted())), [])

  return (
    <button
      type="button"
      className="btn ghost sound-btn"
      aria-pressed={muted}
      onClick={() => writeMuted(!muted)}
    >
      {muted ? "Unmute" : "Mute"}
    </button>
  )
}

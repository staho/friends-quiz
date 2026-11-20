import { useEffect, useState } from "react"
import { t } from "./strings"
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
      {muted ? t.unmute : t.mute}
    </button>
  )
}

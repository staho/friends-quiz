import { useEffect } from "react"
import { HostScreen } from "./screens/HostScreen"
import { PlayerScreen } from "./screens/PlayerScreen"
import { installSoundUnlock } from "./sound"
import { useWakeLock } from "./useWakeLock"

export function App() {
  useEffect(() => installSoundUnlock(), [])
  useWakeLock()
  const path = window.location.pathname.replace(/\/+$/, "")
  return path === "/host" ? <HostScreen /> : <PlayerScreen />
}

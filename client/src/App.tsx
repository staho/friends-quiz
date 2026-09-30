import { HostScreen } from "./screens/HostScreen"
import { PlayerScreen } from "./screens/PlayerScreen"

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "")
  return path === "/host" ? <HostScreen /> : <PlayerScreen />
}

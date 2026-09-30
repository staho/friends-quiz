import { useEffect, useState } from "react"
import type { RoomSnapshot } from "@shared/types"
import { socket } from "./socket"

export function useRoom() {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [connected, setConnected] = useState(socket.connected)

  useEffect(() => {
    const onState = (next: RoomSnapshot) => setSnapshot(next)
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    socket.on("state", onState)
    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    return () => {
      socket.off("state", onState)
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
    }
  }, [])

  return { snapshot, connected }
}

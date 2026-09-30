import { io, type Socket } from "socket.io-client"
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "@shared/types"

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io()

export function request<T>(emit: (ack: (res: Ack<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    emit((res) => {
      if (res.ok) resolve(res.data)
      else reject(new Error(res.error))
    })
  })
}

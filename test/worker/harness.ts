// Starts the real Worker with wrangler's unstable_startWorker (local workerd, no network).
// wrangler.jsonc is parsed with JSON.parse, so keep that file free of comments.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { unstable_startWorker as startWorker } from "wrangler"
import type { RoomSnapshot } from "../../shared/types.ts"

process.env.WRANGLER_SEND_METRICS = "false"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export interface TestWorker {
  url: string
  dispose(): Promise<void>
}

export async function startTestWorker(options: { assetsDir?: string } = {}): Promise<TestWorker> {
  const config = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8")) as Record<string, unknown>
  for (const key of ["routes", "previews", "observability", "$schema"]) delete config[key]
  const dir = mkdtempSync(path.join(os.tmpdir(), "fq-worker-"))
  let assetsDir = options.assetsDir
  if (!assetsDir) {
    assetsDir = path.join(dir, "assets")
    mkdirSync(assetsDir)
    writeFileSync(path.join(assetsDir, "index.html"), "<!doctype html><title>test</title>")
  }
  config.main = path.join(root, "worker/index.ts")
  config.assets = { ...(config.assets as object), directory: assetsDir }
  const configPath = path.join(dir, "wrangler.json")
  writeFileSync(configPath, JSON.stringify(config))
  const worker = await startWorker({
    config: configPath,
    dev: { server: { port: 0 }, inspector: false, persist: false, logLevel: "warn" },
  })
  await worker.ready
  const url = (await worker.url).toString().replace(/\/$/, "")
  return { url, dispose: () => worker.dispose() }
}

export type Reply = { id: string; ok: boolean; data?: unknown; error?: string }

export interface Client {
  state: RoomSnapshot | null
  rpc(event: string, payload?: unknown): Promise<Reply>
  send(event: string, payload?: unknown): void
  waitFor(predicate: (state: RoomSnapshot) => boolean, timeoutMs?: number): Promise<RoomSnapshot>
  close(): void
}

// The room-creation limit is keyed on CF-Connecting-IP (server/http.ts clientKey), so every call
// gets its own fake client IP unless one is given; tests then cannot starve each other's quota.
let nextClient = 0
export function uniqueClientIp(): string {
  const n = ++nextClient
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
}

export async function createRoom(url: string, clientIp = uniqueClientIp()): Promise<{ code: string; hostToken: string }> {
  const res = await fetch(`${url}/api/rooms`, { method: "POST", headers: { "CF-Connecting-IP": clientIp } })
  if (res.status !== 201) throw new Error(`create room: ${res.status}`)
  return (await res.json()) as { code: string; hostToken: string }
}

export async function connect(url: string, code: string): Promise<Client> {
  const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws/${code}`)
  const pending = new Map<string, (reply: Reply) => void>()
  const watchers = new Set<(state: RoomSnapshot) => void>()
  let counter = 0
  const client: Client = {
    state: null,
    rpc(event, payload) {
      const id = `m${++counter}`
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no reply to ${event}`)), 15_000)
        pending.set(id, (reply) => {
          clearTimeout(timer)
          resolve(reply)
        })
        ws.send(JSON.stringify({ id, event, ...(payload === undefined ? {} : { payload }) }))
      })
    },
    send(event, payload) {
      const id = `m${++counter}`
      ws.send(JSON.stringify({ id, event, ...(payload === undefined ? {} : { payload }) }))
    },
    waitFor(predicate, timeoutMs = 10_000) {
      return new Promise<RoomSnapshot>((resolve, reject) => {
        if (client.state && predicate(client.state)) return resolve(client.state)
        const timer = setTimeout(() => {
          watchers.delete(check)
          reject(new Error(`timed out; last state: ${JSON.stringify(client.state?.phase)}`))
        }, timeoutMs)
        const check = (state: RoomSnapshot) => {
          if (!predicate(state)) return
          clearTimeout(timer)
          watchers.delete(check)
          resolve(state)
        }
        watchers.add(check)
      })
    },
    close() {
      ws.close()
    },
  }
  ws.addEventListener("message", (event) => {
    const text = String(event.data)
    if (text === "pong") return
    const message = JSON.parse(text) as { event?: string; data?: RoomSnapshot } & Partial<Reply>
    if (message.event === "state" && message.data) {
      client.state = message.data
      for (const watcher of [...watchers]) watcher(message.data)
    } else if (typeof message.id === "string") {
      pending.get(message.id)?.(message as Reply)
      pending.delete(message.id)
    }
  })
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("error", () => reject(new Error("websocket failed to open")), { once: true })
  })
  return client
}

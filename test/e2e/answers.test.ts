// TV answers never break a word, whatever the length: the longest answers in the bank (up to 32
// characters) and single words of 20 letters, on the question and on the reveal, at 1080p and 720p,
// with 4 and with 20 players. The answers are swapped in on the way from the socket to the page,
// because the bank deals random questions.
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, describe, it } from "node:test"
import { chromium, type Browser, type Page } from "playwright-core"
import type { RoomSnapshot } from "../../shared/types.ts"
import { connect, startTestWorker, uniqueClientIp, type Client, type TestWorker } from "../worker/harness.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const SETS: [string, string, string, string][] = [
  ["Kilimandżaro", "Rembrandt", "Pomarańczowy", "Władysław IV Waza"],
  ["Władysław III Warneńczyk", "Stanisław Ignacy Witkiewicz", "Wykluczenie z gry", "Cieśnina Gibraltarska"],
  ["Czterdziestolatkowie", "Trzynastoletnia", "Skłodowska-Curie", "Rimski-Korsakow"],
  ["Konstytucja Trzeciego Maja 1791r", "Przeciwdziałałabyśmy", "Ułan", "Ż"],
]

let worker: TestWorker
let browser: Browser
const opened: Client[] = []

before(async () => {
  worker = await startTestWorker({ assetsDir: path.join(root, "client/dist") })
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" })
})
after(async () => {
  for (const client of opened) client.close()
  await browser?.close()
  await worker?.dispose()
})

/** Words (split at spaces and hyphens) that sit on more than one line, and tiles whose text overflows. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    for (const label of document.querySelectorAll<HTMLElement>(".answer-grid.tv .label")) {
      const node = label.firstChild
      if (!(node instanceof Text)) continue
      const text = node.data
      for (const match of text.matchAll(/[^\s\-–]+/g)) {
        const range = document.createRange()
        range.setStart(node, match.index ?? 0)
        range.setEnd(node, (match.index ?? 0) + match[0].length)
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
        if (lines.size > 1) problems.push(`broken: ${match[0]}`)
      }
      if (label.scrollWidth > label.clientWidth + 1) problems.push(`overflow: ${text}`)
      const tile = label.closest<HTMLElement>(".answer")
      const grid = label.closest<HTMLElement>(".answer-grid")
      if (tile && grid) {
        const box = tile.getBoundingClientRect()
        const outer = grid.getBoundingClientRect()
        if (box.left < outer.left - 1 || box.right > outer.right + 1) problems.push(`tile outside: ${text}`)
      }
      const fontSize = Number.parseFloat(getComputedStyle(label).fontSize)
      if (fontSize < 14) problems.push(`tiny text (${fontSize}px): ${text}`)
    }
    return problems
  })
}

async function standingsFit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    if (document.documentElement.scrollHeight > innerHeight) out.push("page scrolls")
    for (const row of document.querySelectorAll(".standings > li")) {
      const box = row.getBoundingClientRect()
      if (box.bottom > innerHeight + 0.5 || box.right > innerWidth + 0.5) out.push("row outside")
      if (box.height < 8) out.push("row squashed")
    }
    return out
  })
}

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]

describe("TV answers keep words whole", { timeout: 300_000 }, () => {
  for (const n of [4, 20]) {
    for (const { width, height } of viewports) {
      it(`${n} players at ${width}x${height}`, async () => {
        const context = await browser.newContext({
          viewport: { width, height },
          extraHTTPHeaders: { "CF-Connecting-IP": uniqueClientIp() },
        })
        try {
          let current = 0
          const tv = await context.newPage()
          await tv.routeWebSocket(/\/ws\//, (page) => {
            const server = page.connectToServer()
            page.onMessage((message) => server.send(message))
            server.onMessage((message) => {
              if (typeof message !== "string") return page.send(message)
              const parsed = JSON.parse(message) as { event?: string; data?: RoomSnapshot }
              const data = parsed.event === "state" ? parsed.data : undefined
              const set = SETS[current]
              if (data && set) {
                if (data.question) data.question.choices = set
                if (data.reveal) data.reveal.choices = set
                page.send(JSON.stringify(parsed))
              } else page.send(message)
            })
          })
          await tv.goto(`${worker.url}/host`)
          await tv.locator(".code").waitFor()
          const label = await tv.locator(".code").getAttribute("aria-label")
          const code = /[A-Z]{4}/.exec(label ?? "")?.[0]
          assert.ok(code, `room code in "${label}"`)

          const clients: Client[] = []
          for (let i = 0; i < n; i++) {
            const client = await connect(worker.url, code)
            opened.push(client)
            const reply = await client.rpc("player:join", { code, name: `Gracz ${String(i + 1).padStart(2, "0")} Imiona`.slice(0, 16) })
            assert.equal(reply.ok, true, `join: ${reply.error}`)
            clients.push(client)
          }
          await tv.locator(".chips li.chip").nth(n - 1).waitFor()
          await tv.keyboard.press("Enter")
          await tv.locator(".board.question .answer").first().waitFor()

          // Question: a pick by the first player pushes a fresh state, which the page shows with set `i`.
          for (let i = 0; i < SETS.length; i++) {
            current = i
            const first = clients[0]
            assert.ok(first)
            assert.equal((await first.rpc("player:choose", { choiceIndex: i % 4 })).ok, true)
            await tv.locator(".board.question .answer .label").first().filter({ hasText: SETS[i]?.[0] ?? "" }).waitFor()
            assert.deepEqual(await layoutProblems(tv), [], `question, set ${i}`)
          }

          await Promise.all(
            clients.map(async (client, i) => {
              assert.equal((await client.rpc("player:choose", { choiceIndex: i % 4 })).ok, true)
              assert.equal((await client.rpc("player:lock")).ok, true)
            }),
          )
          await tv.locator(".board.reveal").waitFor()
          for (let i = 0; i < SETS.length; i++) {
            current = i
            await tv.keyboard.press("Space")
            await tv.locator(".board.reveal .answer .label").first().filter({ hasText: SETS[i]?.[0] ?? "" }).waitFor()
            assert.deepEqual(await layoutProblems(tv), [], `reveal, set ${i}`)
            assert.deepEqual(await standingsFit(tv), [], `reveal standings, set ${i}`)
          }
          for (const client of clients) client.close()
        } finally {
          await context.close()
        }
      })
    }
  }
})

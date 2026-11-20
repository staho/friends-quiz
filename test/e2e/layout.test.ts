// TV-fit checks: nothing scrolls and no standings row leaves the screen, for 4 to 20 players at
// 1080p and 720p, on the reveal and on the final board; and a 320 px phone on the reveal.
// Screenshots go to test-output/ (CI uploads them).
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, describe, it } from "node:test"
import { chromium, type Browser, type Page } from "playwright-core"
import { connect, createRoom, startTestWorker, uniqueClientIp, type Client, type TestWorker } from "../worker/harness.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outDir = path.join(root, "test-output")

let worker: TestWorker
let browser: Browser
const opened: Client[] = []

before(async () => {
  mkdirSync(outDir, { recursive: true })
  worker = await startTestWorker({ assetsDir: path.join(root, "client/dist") })
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" })
})
after(async () => {
  for (const client of opened) client.close()
  await browser?.close()
  await worker?.dispose()
})

async function player(code: string, name: string): Promise<Client> {
  const client = await connect(worker.url, code)
  opened.push(client)
  const reply = await client.rpc("player:join", { code, name })
  assert.equal(reply.ok, true, `join ${name}: ${reply.error}`)
  return client
}

// Full-length names, the widest case for a row.
const nameOf = (i: number) => `Gracz ${String(i + 1).padStart(2, "0")} Imiona`.slice(0, 16)

async function assertFits(page: Page, selector: string, label: string): Promise<void> {
  const fit = await page.evaluate((sel) => {
    const height = window.innerHeight
    const width = window.innerWidth
    const outside = [...document.querySelectorAll(sel)]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.top < -0.5 || box.left < -0.5 || box.bottom > height + 0.5 || box.right > width + 0.5
      })
      .map((el) => el.querySelector(".st-name")?.textContent ?? el.className)
    return {
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      innerHeight: height,
      innerWidth: width,
      outside,
    }
  }, selector)
  assert.ok(fit.scrollHeight <= fit.innerHeight, `${label}: scrollHeight ${fit.scrollHeight} > ${fit.innerHeight}`)
  assert.ok(fit.scrollWidth <= fit.innerWidth, `${label}: scrollWidth ${fit.scrollWidth} > ${fit.innerWidth}`)
  assert.deepEqual(fit.outside, [], `${label}: elements outside the viewport`)
}

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]

describe("TV layout", { timeout: 300_000 }, () => {
  for (const n of [4, 8, 12, 20]) {
    for (const { width, height } of viewports) {
      it(`${n} players at ${width}x${height}`, async () => {
        const context = await browser.newContext({
          viewport: { width, height },
          extraHTTPHeaders: { "CF-Connecting-IP": uniqueClientIp() },
        })
        try {
          const tv = await context.newPage()
          await tv.goto(`${worker.url}/host`)
          await tv.locator(".code").waitFor()
          const label = await tv.locator(".code").getAttribute("aria-label")
          const code = /[A-Z]{4}/.exec(label ?? "")?.[0]
          assert.ok(code, `room code in "${label}"`)

          const clients: Client[] = []
          for (let i = 0; i < n; i++) clients.push(await player(code, nameOf(i)))
          await tv.locator(".chips li.chip").nth(n - 1).waitFor()
          await tv.keyboard.press("Enter")
          await Promise.all(
            clients.map(async (client, i) => {
              await client.waitFor((s) => s.phase === "question")
              const pick = await client.rpc("player:choose", { choiceIndex: i % 4 })
              assert.equal(pick.ok, true, `choose: ${pick.error}`)
              const lock = await client.rpc("player:lock")
              assert.equal(lock.ok, true, `lock: ${lock.error}`)
            }),
          )
          await tv.locator(".board.reveal").waitFor()
          await tv.keyboard.press("Space")
          await tv.getByText(/^Pauza · zostało/).waitFor()
          assert.equal(await tv.locator(".standings > li").count(), n)
          await assertFits(tv, ".standings > li", `reveal ${n} ${width}x${height}`)
          await tv.screenshot({ path: path.join(outDir, `tv-${n}-${width}x${height}-reveal.png`) })

          await tv.getByRole("button", { name: "Zakończ", exact: true }).click()
          await tv.getByRole("button", { name: "Naciśnij jeszcze raz, żeby zakończyć" }).click()
          await tv.locator(".board.final").waitFor()
          const steps = await tv.locator(".podium .step").count()
          await tv.locator(".podium .step.shown").nth(steps - 1).waitFor({ timeout: 10_000 })
          await tv.waitForTimeout(800)
          await assertFits(tv, ".board.final .standings > li, .podium .step", `final ${n} ${width}x${height}`)
          await tv.screenshot({ path: path.join(outDir, `tv-${n}-${width}x${height}-final.png`) })
          for (const client of clients) client.close()
        } finally {
          await context.close()
        }
      })
    }
  }
})

describe("phone layout", { timeout: 60_000 }, () => {
  it("fits a 320x568 phone on the reveal", async () => {
    const { code, hostToken } = await createRoom(worker.url)
    const host = await connect(worker.url, code)
    opened.push(host)
    assert.equal((await host.rpc("host:attach", { code, hostToken })).ok, true)
    const settings = { questionDurationMs: 20_000, revealDurationMs: 8_000, autoAdvance: false, difficulty: "mixed" }
    assert.equal((await host.rpc("host:settings", settings)).ok, true)
    const rival = await player(code, "Rywal")

    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 })
    try {
      const page = await context.newPage()
      await page.goto(`${worker.url}/`)
      await page.fill('input[name="quiz-room-code"]', code)
      await page.fill('input[name="quiz-player-name"]', "Marianna Maria")
      await page.getByRole("button", { name: "Dołącz", exact: true }).click()
      await page.getByText("Jesteś w grze").waitFor()
      assert.equal((await host.rpc("host:start")).ok, true)
      await page.locator(".answer-grid.phone button").first().waitFor()
      await assertFits(page, ".phone-play", "phone question 320x568")
      await page.locator(".answer-grid.phone button").first().click()
      await rival.waitFor((s) => s.phase === "question")
      assert.equal((await rival.rpc("player:choose", { choiceIndex: 1 })).ok, true)
      assert.equal((await rival.rpc("player:lock")).ok, true)
      await page.getByRole("button", { name: "Zatwierdź", exact: true }).click()
      await page.locator(".phone-wait.reveal").waitFor()
      await assertFits(page, ".phone-wait.reveal", "phone reveal 320x568")
      await page.screenshot({ path: path.join(outDir, "phone-320x568-reveal.png") })
    } finally {
      await context.close()
    }
  })
})

// Renders the PNG icons and the link-preview image into client/public with the machine's Chrome.
// Usage: node scripts/render-icons.mjs   (CHROME_PATH overrides /usr/bin/google-chrome)
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../client/public")
mkdirSync(out, { recursive: true })

const AMBER = "#f5a524"
const INK = "#1a120c"
const font = "font-family: Arial, Helvetica, sans-serif; font-weight: 800;"

// Full-bleed tiles, so the 512 one also works as a maskable icon: the "?" stays in the safe zone.
const tile = (size) => `<body style="margin:0;width:${size}px;height:${size}px;background:${AMBER};display:grid;place-items:center">
<div style="${font}font-size:${Math.round(size * 0.62)}px;line-height:1;color:${INK};margin-top:${-Math.round(size * 0.03)}px">?</div></body>`

const preview = `<body style="margin:0;width:1200px;height:630px;background:#fff4e4;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box">
<div style="width:300px;height:300px;border-radius:68px;background:${AMBER};display:grid;place-items:center;flex:none">
<div style="${font}font-size:200px;line-height:1;color:${INK}">?</div></div>
<div style="${font}color:${INK}"><div style="font-size:84px;line-height:1.05">Quiz ze znajomymi</div>
<div style="font-size:38px;font-weight:600;margin-top:24px;line-height:1.3">Jeden telewizor, telefon każdego gracza.</div></div></body>`

const jobs = [
  ["icon-192.png", 192, 192, tile(192)],
  ["icon-512.png", 512, 512, tile(512)],
  ["apple-touch-icon.png", 180, 180, tile(180)],
  ["og.png", 1200, 630, preview],
]

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" })
try {
  for (const [file, width, height, html] of jobs) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(html)
    await page.screenshot({ path: path.join(out, file) })
    await page.close()
    console.log(`wrote ${file}`)
  }
} finally {
  await browser.close()
}

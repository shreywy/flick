// End-to-end runs against the built app. Usage: node e2e/run.mjs <scenario> [outDir]
// Needs FLICK_DATA (a throwaway data folder). Scenarios live in e2e/scenarios.mjs.
import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as scenarios from './scenarios.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [name, out = path.join(root, 'e2e', 'out')] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })

const app = await electron.launch({
  ...(process.env.FLICK_EXE ? { executablePath: process.env.FLICK_EXE, args: [] } : { args: [root] }),
  env: { ...process.env, FLICK_DEV: '1', FLICK_E2E: '1' },
  timeout: 60000,
  ...(process.env.E2E_VIDEO ? { recordVideo: { dir: process.env.E2E_VIDEO, size: { width: 1720, height: 696 } } } : {}),
})
const page = await app.firstWindow()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.name}: ${e.message} ${e.stack ?? ""}`))
await page.waitForLoadState('domcontentloaded')

let n = 0
const shot = async (label) => {
  const file = path.join(out, `${String(++n).padStart(2, '0')}-${label}.png`)
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const ctx = { app, page, shot, log: (...a) => console.log(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }

let failed = false
try {
  await scenarios[name](ctx)
} catch (e) {
  failed = true
  console.log('FAILED:', e.message)
  await shot('failure').catch(() => {})
} finally {
  const errs = process.env.E2E_ALL ? logs : logs.filter((l) => /error|warn/i.test(l))
  if (errs.length) console.log('console:\n' + errs.slice(0, 30).join('\n'))
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)

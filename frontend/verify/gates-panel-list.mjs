import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const consoleMessages = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleMessages.push({ type: m.type(), text: m.text() })
})
page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }))

const shot = async (name) => {
  const p = join(OUT, `gates-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log('  shot →', name)
}

const loginAs = async (username, password) => {
  await page.locator('input[name="cu-username"]').fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 8000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
}

const chat = async (msg) => {
  const input = page.locator('textarea')
  await input.fill(msg)
  await page.getByRole('button', { name: /^send$/ }).click()
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea')
      return ta && !ta.disabled && ta.value === ''
    },
    undefined,
    { timeout: 15000 },
  )
  await page.waitForTimeout(700)
}

await page.goto(URL, { waitUntil: 'networkidle' })
// clear any persisted session to ensure clean login as admin
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.waitForSelector('input[name="cu-username"]', { timeout: 8000 })
console.log('→ login as admin')
await loginAs('admin', 'admin123')
await shot('01-home')

console.log('→ assertion: 10 gate rows in panel')
const rows = await page.locator('[data-testid="gates-panel"] > [data-testid^="gate-row-"]').count()
console.log('  rows =', rows)
if (rows !== 10) throw new Error(`expected 10 rows, got ${rows}`)

console.log('→ querying actual gate states from backend')
const gates = await page.evaluate(() =>
  fetch('/api/gates').then((r) => r.json()),
)
const lockedIds = gates.filter((g) => g.status === 'locked').map((g) => g.id)
const openIds = gates.filter((g) => g.status === 'open').map((g) => g.id)
console.log('  locked:', lockedIds.join(','), '| open:', openIds.join(','))

console.log('→ assertion: every locked gate shows lock icon')
for (const id of lockedIds) {
  const visible = await page.locator(`[data-testid="gates-panel"] [data-testid="gate-lock-${id}"]`).count()
  if (visible !== 1) throw new Error(`gate ${id} (locked) expected lock icon, got ${visible}`)
}
console.log('  ok')

const bgOf = (id) =>
  page.locator(`[data-testid="gates-panel"] [data-testid="gate-status-${id}"]`).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  )
const OLIVE = 'rgb(139, 157, 90)'
const TERRA = 'rgb(201, 84, 62)'

console.log('→ assertion: open gates show olive status circle (computed bg)')
for (const id of openIds) {
  const c = await bgOf(id)
  if (c !== OLIVE) throw new Error(`gate ${id} expected ${OLIVE}, got ${c}`)
}
console.log('  ok')

console.log('→ assertion: non-open gates show terracotta status circle')
for (const g of gates) {
  if (g.status === 'open') continue
  const c = await bgOf(g.id)
  if (c !== TERRA) throw new Error(`gate ${g.id} (${g.status}) expected ${TERRA}, got ${c}`)
}
console.log('  ok')

await shot('02-baseline')

// Install a MutationObserver on the gate-5 status circle so we capture every
// inline-style frame Framer emits during the color tween.
await page.evaluate(() => {
  const target = document.querySelector('[data-testid="gates-panel"] [data-testid="gate-status-5"]')
  if (!target) return
  // @ts-ignore
  window.__bgFrames = []
  // @ts-ignore
  window.__bgFrames.push({ t: 0, bg: getComputedStyle(target).backgroundColor })
  const t0 = performance.now()
  const obs = new MutationObserver(() => {
    // @ts-ignore
    window.__bgFrames.push({ t: Math.round(performance.now() - t0), bg: getComputedStyle(target).backgroundColor })
  })
  obs.observe(target, { attributes: true, attributeFilter: ['style'] })
  // @ts-ignore
  window.__bgObs = obs
})

console.log('→ chat: lock gate 5 — capturing tween frames via MutationObserver')
await chat('lock gate 5')
await page.waitForTimeout(600)
const frames = await page.evaluate(() => {
  // @ts-ignore
  if (window.__bgObs) window.__bgObs.disconnect()
  // @ts-ignore
  return window.__bgFrames || []
})
const distinct = [...new Set(frames.map((f) => f.bg))]
console.log(`  ${frames.length} mutation frames, ${distinct.length} distinct colors`)
if (frames.length > 0) {
  console.log(`  first 6: ${frames.slice(0, 6).map((f) => `${f.t}ms→${f.bg}`).join('  |  ')}`)
}
if (distinct.length < 3) {
  throw new Error(`expected ≥3 distinct interpolated colors during tween, got ${distinct.length}`)
}
const finalC = await bgOf(5)
if (finalC !== TERRA) throw new Error(`gate 5 final bg expected ${TERRA}, got ${finalC}`)
const g5lock = await page.locator('[data-testid="gates-panel"] [data-testid="gate-lock-5"]').count()
if (g5lock !== 1) throw new Error('gate 5 should now show lock icon')
await shot('03-after-lock-5')

console.log('→ chat: unlock then open gate 5')
await chat('unlock gate 5')
await chat('open gate 5')
const g5final = await bgOf(5)
console.log('  gate 5 bg after open =', g5final)
if (g5final !== OLIVE) throw new Error(`gate 5 expected ${OLIVE}, got ${g5final}`)
await shot('04-after-open-5')

console.log('\n--- summary ---')
if (consoleMessages.length === 0) {
  console.log('console: clean')
} else {
  console.log('console messages:')
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)
}

await browser.close()

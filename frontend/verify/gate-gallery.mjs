import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 })
const page = await context.newPage()

const consoleMessages = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleMessages.push({ type: msg.type(), text: msg.text() })
  }
})
page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }))

const shot = async (name) => {
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  console.log(`  wrote ${path}`)
}

const step = async (label, fn) => {
  console.log(`→ ${label}`)
  await fn()
}

await step('load', async () => {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900) // let Framer Motion initial springs settle
  await shot('01-initial')
})

await step('open all', async () => {
  await page.getByRole('button', { name: 'Open all' }).click()
  await page.waitForTimeout(900)
  await shot('02-all-open')
})

await step('close all', async () => {
  await page.getByRole('button', { name: 'Close all' }).click()
  await page.waitForTimeout(900)
  await shot('03-all-closed')
})

await step('lock gate 1', async () => {
  // The per-gate buttons are all lowercase: open/close/lock/deny
  await page.getByRole('button', { name: 'lock', exact: true }).first().click()
  await page.waitForTimeout(700)
  await shot('04-gate1-locked')
})

await step('deny gate 2 — sample shake displacement', async () => {
  // Grab the second GateCard by its label so we don't depend on DOM order
  const cardSelector = 'div:has(> div:has-text("Loading Dock"))'
  const card = page.locator('.rounded-xl.surface', { hasText: 'Loading Dock' }).first()

  // Baseline
  const before = await card.boundingBox()

  // Fire denial
  await page.getByRole('button', { name: 'deny', exact: true }).nth(1).click()

  // Sample X every ~40ms for 700ms to see if the shake is actually moving the card
  const samples = []
  const startT = Date.now()
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(40)
    const box = await card.boundingBox()
    if (box && before) {
      samples.push({ t: Date.now() - startT, dx: +(box.x - before.x).toFixed(2) })
    }
  }

  const maxAbs = Math.max(...samples.map((s) => Math.abs(s.dx)))
  console.log(`  shake samples (t/dx): ${samples.map((s) => `${s.t}/${s.dx}`).join(' ')}`)
  console.log(`  max |dx|: ${maxAbs}px`)

  // Grab one screenshot when displacement appears non-zero
  await page.getByRole('button', { name: 'deny', exact: true }).nth(1).click()
  await page.waitForTimeout(50)
  await shot('05-gate2-deny-early')
  await page.waitForTimeout(120)
  await shot('06-gate2-deny-mid')
  await page.waitForTimeout(500)
  await shot('07-gate2-deny-settled')
})

await step('open gate 3', async () => {
  await page.getByRole('button', { name: 'open', exact: true }).nth(2).click()
  await page.waitForTimeout(900)
  await shot('08-gate3-open')
})

// Capture the SVG bounding box for gate 1 to measure whether doors actually rotated
const gate1DoorOpacity = await page.evaluate(() => {
  const svg = document.querySelectorAll('svg')[0]
  if (!svg) return null
  return { w: svg.clientWidth, h: svg.clientHeight }
})

console.log('\n--- summary ---')
console.log('gate 1 svg box:', gate1DoorOpacity)
if (consoleMessages.length === 0) {
  console.log('console: clean (no errors, no warnings)')
} else {
  console.log('console messages:')
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)
}

await browser.close()

// Verifies the new RequestSheet modal (Phase A frontend rebuild) against the
// local dev server on :5173. Captures screenshots through the erase animation
// phases.
//
// Pre-reqs (must already be running):
//   - frontend dev server  : npm run dev          (http://127.0.0.1:5173)
//   - backend api          : docker compose up    (http://127.0.0.1:8000)
//
// Run:  node verify/request-sheet-modal.mjs

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'http://127.0.0.1:5173/'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
})
const page = await context.newPage()

const consoleMessages = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleMessages.push({ type: msg.type(), text: msg.text() })
  }
})
page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }))

const shot = async (name) => {
  const p = join(OUT, `sheet-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log('  shot →', name)
}

const step = async (label, fn) => {
  console.log(`\n→ ${label}`)
  await fn()
}

await step('load app', async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  await shot('01-login')
})

await step('login as IReallyRock via demo chip', async () => {
  await page.locator('button', { hasText: 'IReallyRock' }).first().click()
  await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)
  await shot('02-home')
})

await step('try open gate 4 (no perm) → modal should pop', async () => {
  // Make sure no pending request exists from a previous run; if it does, the
  // executor sends a RequestCard instead of a RequestForm. We just type the
  // message and check what happens.
  const input = page.locator('textarea[placeholder^="tell me"]')
  await input.fill('open gate 4')
  await page.getByRole('button', { name: /^send$/i }).click()
  await page.waitForTimeout(1500)

  const modalCount = await page.locator('[data-testid="request-sheet-modal"]').count()
  console.log(`  modal present: ${modalCount > 0 ? '✅' : '❌'}`)
  await shot('03-modal-open')

  if (modalCount === 0) {
    console.log('  ⚠️  no modal — likely a pending request already exists. Cancel any pending request and re-run.')
  }
})

await step('fill all 7 fields', async () => {
  const fields = {
    name: 'Kevin Lee',
    employeeId: 'E12345',
    department: 'Engineering',
    contact: 'kevin@company.example',
    visitor: 'no — employee',
    intention: 'late shift, lock-up access',
  }
  for (const [key, value] of Object.entries(fields)) {
    const input = page.locator(`[data-testid="rs-input-${key}"]`)
    await input.fill(value)
  }
  // dateTime gets a default so just tap it once to confirm a value.
  await page.locator('[data-testid="rs-input-dateTime"]').focus()
  await page.waitForTimeout(200)
  await shot('04-filled')
})

await step('submit → capture animation phases', async () => {
  await page.locator('[data-testid="rs-submit"]').click()
  await page.waitForTimeout(200)
  await shot('05-erase-200ms')
  await page.waitForTimeout(600)
  await shot('06-erase-800ms')
  await page.waitForTimeout(700)
  await shot('07-erase-1500ms')
  await page.waitForTimeout(1000)
  await shot('08-confirm-2500ms')
  await page.waitForTimeout(800)
  await shot('09-after-3300ms')
})

await step('verify modal dismissed + RequestCard appeared', async () => {
  const modalLeft = await page.locator('[data-testid="request-sheet-modal"]').count()
  const cardCount = await page.locator('text=/request #\\d+/').count()
  console.log(`  modal still in DOM: ${modalLeft > 0 ? '⚠️ yes' : '✅ no'}`)
  console.log(`  RequestCard rendered in chat: ${cardCount > 0 ? '✅' : '❌'}`)
  await shot('10-final')
})

console.log('\n--- summary ---')
if (consoleMessages.length === 0) {
  console.log('console: clean')
} else {
  console.log(`console messages (${consoleMessages.length}):`)
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)
}

await browser.close()

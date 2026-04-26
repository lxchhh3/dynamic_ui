import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'https://127.0.0.1:18443/'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

const consoleMessages = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleMessages.push({ type: m.type(), text: m.text() })
})
page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }))

const shot = async (name) => {
  const p = join(OUT, `sheet-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
}

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[name="cu-username"]', { timeout: 8000 })
await page.locator('input[name="cu-username"]').fill('IReallyRock')
await page.locator('input[type="password"]').fill('rockrock')
await page.getByRole('button', { name: /^sign in$/i }).click()
await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 8000 })
await page.waitForTimeout(1000)

// Set up the row-erase observer BEFORE triggering the modal so we capture
// the auto-erase that fires on popup.
await page.evaluate(() => {
  // @ts-ignore
  window.__rowEraseTimes = new Map()
  // @ts-ignore
  window.__t0 = null
  const startObserver = () => {
    const modal = document.querySelector('[data-testid="request-sheet-modal"]')
    if (!modal) {
      requestAnimationFrame(startObserver)
      return
    }
    // @ts-ignore
    window.__t0 = performance.now()
    const watch = () => {
      const rows = modal.querySelectorAll('.group')
      rows.forEach((row, i) => {
        const obs = new MutationObserver(() => {
          // @ts-ignore
          if (row.querySelector('[data-char]') && !window.__rowEraseTimes.has(i)) {
            // @ts-ignore
            window.__rowEraseTimes.set(i, Math.round(performance.now() - window.__t0))
          }
        })
        obs.observe(row, { childList: true, subtree: true })
      })
    }
    if (modal.querySelectorAll('.group').length === 0) {
      const top = new MutationObserver(() => {
        if (modal.querySelectorAll('.group').length > 0) {
          top.disconnect()
          watch()
        }
      })
      top.observe(modal, { childList: true, subtree: true })
    } else {
      watch()
    }
  }
  // @ts-ignore
  window.__startRowObs = startObserver
})

console.log('→ open gate 4 to trigger sheet')
await page.locator('textarea').fill('open gate 4')
await page.getByRole('button', { name: /^send$/ }).click()
await page.evaluate(() => {
  // @ts-ignore
  window.__startRowObs()
})
await page.waitForSelector('[data-testid="request-sheet-modal"]', { timeout: 10000 })
console.log('  modal mounted')
await shot('00-mounted')

// Wait for the popup auto-erase to play out.
await page.waitForTimeout(3500)

const popupEraseTimes = await page.evaluate(() => {
  // @ts-ignore
  return Array.from(window.__rowEraseTimes.entries()).sort((a, b) => a[1] - b[1])
})
console.log('  popup auto-erase order (rowIdx → ms after modal):')
for (const [i, t] of popupEraseTimes) console.log(`    row ${i}: ${t}ms`)

const collapsedAfterPopup = await page.evaluate(() => {
  // Rows whose container has height ≈ 0 after the auto-erase
  const rows = document.querySelectorAll('[data-testid="request-sheet-modal"] .group')
  return Array.from(rows)
    .map((r, i) => ({ i, h: r.getBoundingClientRect().height }))
    .filter((r) => r.h < 5)
    .map((r) => r.i)
})
console.log('  collapsed rows after popup phase:', collapsedAfterPopup.join(','))
await shot('01-after-popup-erase')

// Reset observer state for the submit phase.
await page.evaluate(() => {
  // @ts-ignore
  window.__rowEraseTimes = new Map()
  // @ts-ignore
  window.__t0 = performance.now()
  const rows = document.querySelectorAll('[data-testid="request-sheet-modal"] .group')
  rows.forEach((row, i) => {
    const obs = new MutationObserver(() => {
      // @ts-ignore
      if (row.querySelector('[data-char]') && !window.__rowEraseTimes.has(i)) {
        // @ts-ignore
        window.__rowEraseTimes.set(i, Math.round(performance.now() - window.__t0))
      }
    })
    obs.observe(row, { childList: true, subtree: true })
  })
})

// Fill the two empty fields.
await page.locator('[data-testid="rs-input-visitor"]').fill('no — employee')
await page.locator('[data-testid="rs-input-intention"]').fill('lock-up shift')
await shot('02-filled')

console.log('→ click submit, capture per-row erase start times')
await page.getByTestId('rs-submit').click()
await page.waitForTimeout(3000)

const eraseTimes = await page.evaluate(() => {
  // @ts-ignore
  const m = window.__rowEraseTimes
  return Array.from(m.entries()).sort((a, b) => a[1] - b[1])
})
console.log('  submit-erase order (rowIdx → ms after submit):')
for (const [i, t] of eraseTimes) console.log(`    row ${i}: ${t}ms`)

// Assertions:
// 1) popup auto-erase: should erase the LLM-picked autoFill rows. For
//    IReallyRock the LLM consistently picks name+employeeId+department+contact
//    → rows 0,1,2,3.
const popupRows = [...popupEraseTimes.map(([i]) => i)].sort((a, b) => a - b)
const expectedAuto = [0, 1, 2, 3]
console.log('  auto-erased rowIdx (sorted):', popupRows.join(','))
console.log('  expected:                    ', expectedAuto.join(','))
if (JSON.stringify(popupRows) !== JSON.stringify(expectedAuto)) {
  throw new Error('popup auto-erase rowset mismatch (LLM may have picked different fields)')
}

// 2) submit erases the remaining visible rows (4 visitor, 5 intention, 6 dateTime).
const submitRows = [...eraseTimes.map(([i]) => i)].sort((a, b) => a - b)
console.log('  submit-erased rowIdx (sorted):', submitRows.join(','))
if (JSON.stringify(submitRows) !== JSON.stringify([4, 5, 6])) {
  throw new Error(`expected submit to erase [4,5,6], got [${submitRows.join(',')}]`)
}

await page.waitForSelector('[data-testid="request-sheet-modal"]', { state: 'detached', timeout: 8000 }).catch(() => {})
await shot('99-final')

console.log('\n--- summary ---')
if (consoleMessages.length === 0) console.log('console: clean')
else for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)

const videoPath = await page.video()?.path()
await context.close()
await browser.close()
console.log('video at:', videoPath)

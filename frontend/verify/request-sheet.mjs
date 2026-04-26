import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'https://127.0.0.1:18443/'

// SSH tunnel: ssh -fN -L 18443:127.0.0.1:443 ubuntu-server
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

// Capture every /api/chat response body so we can see the SSE stream the server
// actually emitted. This is the diagnostic that matters.
const chatResponses = []
page.on('response', async (resp) => {
  const u = resp.url()
  if (!u.includes('/api/chat')) return
  try {
    const text = await resp.text()
    chatResponses.push({ url: u, status: resp.status(), body: text })
  } catch (e) {
    chatResponses.push({ url: u, status: resp.status(), body: `<error: ${e.message}>` })
  }
})

const shot = async (name) => {
  const p = join(OUT, `req-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log('  shot →', name)
}

const step = async (label, fn) => {
  console.log(`\n→ ${label}`)
  await fn()
}

const loginAs = async (username, password) => {
  // Demo chips short-circuit the password manager. Click the chip whose visible
  // text contains the username; if not present (custom user), fill the form.
  const chip = page.locator('button', { hasText: username }).first()
  if (await chip.count()) {
    await chip.click()
  } else {
    // Form fields use autoComplete="off" + name="cu-username" / name="cu-password".
    const inputs = page.locator('form input')
    await inputs.nth(0).fill(username)
    await inputs.nth(1).fill(password)
    await page.getByRole('button', { name: /^sign in$/i }).click()
  }
  await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 10000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
}

const chat = async (msg) => {
  const before = chatResponses.length
  // The chat input textarea has a placeholder starting with "tell me what to do".
  const input = page.locator('textarea[placeholder^="tell me"]')
  await input.fill(msg)
  await page.getByRole('button', { name: /^send$/i }).click()
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea[placeholder^="tell me"]')
      return ta && !ta.disabled && ta.value === ''
    },
    undefined,
    { timeout: 20000 },
  )
  await page.waitForTimeout(700)
  // Print the freshly captured chat response.
  const fresh = chatResponses.slice(before)
  for (const r of fresh) {
    console.log(`  ← /api/chat ${r.status}`)
    const blocks = r.body
      .split('\n\n')
      .map((f) => {
        const dataLine = f.split('\n').find((l) => l.startsWith('data:'))
        return dataLine ? dataLine.slice(5).trim() : null
      })
      .filter(Boolean)
    for (const b of blocks) {
      console.log('    ·', b.length > 600 ? b.slice(0, 600) + '…' : b)
    }
  }
}

const logout = async () => {
  await page.getByRole('button', { name: /sign out/i }).click()
  await page.waitForSelector('text=/create account|sign in/i', { timeout: 5000 })
}

await step('load app', async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  await shot('01-login')
})

await step('login as IReallyRock (regular user)', async () => {
  await loginAs('IReallyRock', 'rockrock')
  await shot('02-home')
})

await step('try open gate 10 (no perm) → expect RequestForm', async () => {
  await chat('open gate 10')
  await shot('03a-denied-with-form')
  const formCount = await page.locator('text=/request sheet/i').count()
  console.log(`  request sheet visible: ${formCount > 0 ? '✅' : '❌'}`)
})

await step('fill the request sheet and submit', async () => {
  const textarea = page.locator('textarea[placeholder*="reason for access"]')
  await textarea.fill('working a late shift, need to lock up')
  const before = chatResponses.length
  await page.getByRole('button', { name: /submit request/i }).click()
  // Wait for a fresh /api/chat round-trip triggered by the form.
  await page.waitForFunction(
    (n) => true,
    before,
    { timeout: 1 },
  ).catch(() => {})
  // Poll until we get a new response.
  const start = Date.now()
  while (chatResponses.length === before && Date.now() - start < 20000) {
    await page.waitForTimeout(200)
  }
  // And then for the chat input textarea (last on page) to settle.
  await page.waitForTimeout(1500)
  await shot('03b-after-submit')
  const cardCount = await page.locator('text=/request #\\d+/').count()
  console.log(`  RequestCard rendered after submit: ${cardCount > 0 ? '✅' : '❌'}`)
  console.log(`  new /api/chat responses captured: ${chatResponses.length - before}`)
})

await step('try open gate 10 again (should now show pending card)', async () => {
  await chat('open gate 10')
  await shot('03c-already-pending')
})

await step('verify RequestCard rendered in DOM', async () => {
  // The RequestCard renders "request #N" — fail loudly if it's missing.
  const cardCount = await page.locator('text=/request #\\d+/').count()
  console.log(`  request #N elements visible: ${cardCount}`)
  if (cardCount === 0) {
    console.log('  ❌ no RequestCard in DOM')
  } else {
    console.log('  ✅ RequestCard present')
  }
})

await step('list my requests', async () => {
  await chat('my requests')
  await shot('04-my-requests')
})

await step('logout, login as admin', async () => {
  await logout()
  await loginAs('admin', 'admin123')
  await shot('05-admin-home')
})

await step('list pending requests as admin', async () => {
  await chat('pending requests')
  await shot('06-admin-pending')
})

await step('approve the latest request', async () => {
  await chat('approve request 2')
  await shot('07-approved')
})

await step('verify approval state in DOM', async () => {
  const approved = await page.locator('text=/approved/i').count()
  console.log(`  "approved" text elements: ${approved}`)
})

console.log('\n--- summary ---')
if (consoleMessages.length === 0) {
  console.log('console: clean')
} else {
  console.log(`console messages (${consoleMessages.length}):`)
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)
}

await browser.close()

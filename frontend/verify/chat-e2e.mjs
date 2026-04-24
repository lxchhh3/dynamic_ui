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
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleMessages.push({ type: msg.type(), text: msg.text() })
  }
})
page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }))

const shot = async (name) => {
  const p = join(OUT, `e2e-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log('  shot →', name)
}

const step = async (label, fn) => {
  console.log(`→ ${label}`)
  await fn()
}

const loginAs = async (username, password) => {
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /^sign in$/, exact: false }).click()
  // "sign out" only exists on Home — waits for the actual navigation.
  await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 8000 })
  await page.waitForLoadState('networkidle')
  // small settle for the GatePanel hydration + GateCard springs
  await page.waitForTimeout(1000)
}

const chat = async (msg) => {
  const input = page.locator('textarea')
  await input.fill(msg)
  await page.getByRole('button', { name: /^send$/ }).click()
  // Stream finished ⇔ textarea no longer disabled (sending=false) and empty.
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea')
      return ta && !ta.disabled && ta.value === ''
    },
    undefined,
    { timeout: 15000 },
  )
  await page.waitForTimeout(700) // settle springs + final stagger
}

const logout = async () => {
  await page.getByRole('button', { name: /sign out/i }).click()
  await page.waitForSelector('text=/create account|sign in/i', { timeout: 5000 })
}

await step('load app (expect login screen)', async () => {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await shot('01-login')
})

await step('login as IReallyRock', async () => {
  await loginAs('IReallyRock', 'rockrock')
  await shot('02-home-hydrated')
})

await step('chat: list gates', async () => {
  await chat('list gates')
  await shot('03-list-gates')
})

await step('chat: open gate 7 (has permission)', async () => {
  await chat('open gate 7')
  await shot('04-open-gate-7-success')
})

await step('chat: open gate 4 (denied - no perm)', async () => {
  await chat('open gate 4')
  await shot('05-open-gate-4-denied')
})

await step('chat: try to lock gate 5 (denied - user)', async () => {
  await chat('lock gate 5')
  await shot('06-lock-denied-user')
})

await step('logout, login as admin', async () => {
  await logout()
  await loginAs('admin', 'admin123')
  await shot('07-admin-home')
})

await step('chat: open gate 4 for IReallyRock (composite)', async () => {
  await chat('open gate 4 for IReallyRock')
  await shot('08-composite-grant-open')
})

await step('chat: who can access gate 4', async () => {
  await chat('who can access gate 4')
  await shot('09-access-list')
})

await step('chat: lock down gate 6', async () => {
  await chat('lock down gate 6')
  await shot('10-admin-lock')
})

await step('chat: help', async () => {
  await chat('help')
  await shot('11-help')
})

await step('chat: gibberish (unknown)', async () => {
  await chat('i wanna eat pizza')
  await shot('12-unknown')
})

await step('logout, login as guest', async () => {
  await logout()
  await loginAs('guest', 'guest')
  await shot('13-guest-home')
})

await step('chat: guest tries to open gate 2', async () => {
  await chat('open gate 2')
  await shot('14-guest-denied')
})

console.log('\n--- summary ---')
if (consoleMessages.length === 0) {
  console.log('console: clean (no errors, no warnings)')
} else {
  console.log(`console messages (${consoleMessages.length}):`)
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`)
}

await browser.close()

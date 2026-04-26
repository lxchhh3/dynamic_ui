import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

const URL = process.env.URL ?? 'https://127.0.0.1:18443/'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
})
const page = await context.newPage()

const consoleMessages = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleMessages.push({ type: m.type(), text: m.text() })
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[name="cu-username"]', { timeout: 8000 })
await page.locator('input[name="cu-username"]').fill('admin')
await page.locator('input[type="password"]').fill('admin123')
await page.getByRole('button', { name: /^sign in$/i }).click()
await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 8000 })
await page.waitForTimeout(800)

const sendChat = async (msg) => {
  await page.locator('textarea').fill(msg)
  await page.getByRole('button', { name: /^send$/ }).click()
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea')
      return ta && !ta.disabled && ta.value === ''
    },
    undefined,
    { timeout: 20000 },
  )
  await page.waitForTimeout(700)
}

const cases = [
  { msg: '打开4号门', expect: /Open|opening|open/i, label: '打开 (open)' },
  { msg: '关闭4号门', expect: /Closed|closing/i, label: '关闭 (close)' },
  { msg: '锁住4号门', expect: /locked|locking/i, label: '锁住 (lock)' },
  { msg: '解锁4号门', expect: /closed|unlocking/i, label: '解锁 (unlock)' },
  { msg: '列出所有门', expect: /Main Entrance|Loading Dock|gates/i, label: '列出所有门 (list)' },
  { msg: '你好', expect: /Hello|hi|你好/i, label: '你好 (greeting → chat-mode)' },
]

let fails = 0
for (const c of cases) {
  console.log(`→ ${c.label}: "${c.msg}"`)
  await sendChat(c.msg)
  // Capture the most recent assistant turn's visible text.
  const visible = await page.evaluate(() => {
    const turns = document.querySelectorAll('[class*="space-y-3"]')
    return turns.length ? turns[turns.length - 1].innerText : ''
  })
  const oneLine = visible.replace(/\s+/g, ' ').slice(0, 200)
  console.log(`  rendered: ${oneLine}`)
  if (c.expect.test(visible)) {
    console.log('  PASS')
  } else {
    console.log('  FAIL — expected match for', c.expect)
    fails++
  }
}

console.log('\n--- summary ---')
console.log(fails ? `${fails} failures` : 'all pass')
if (consoleMessages.length) {
  console.log('console:')
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text.slice(0, 200)}`)
}
await browser.close()
process.exit(fails ? 1 : 0)

import { chromium } from '@playwright/test'

const URL = process.env.URL ?? 'https://127.0.0.1:18443/'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ignoreHTTPSErrors: true,
})
const page = await context.newPage()

const captured = []
page.on('response', async (resp) => {
  if (!resp.url().includes('/api/chat')) return
  try {
    captured.push({ url: resp.url(), status: resp.status(), body: await resp.text() })
  } catch {}
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)

// Login as IReallyRock via demo chip.
await page.locator('button', { hasText: 'IReallyRock' }).first().click()
await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 10000 })
await page.waitForTimeout(800)

// Use sse-aware page.on instead of resp.text() (which blocks on streaming).
const sseFrames = []
page.on('request', (req) => {
  if (req.url().includes('/api/chat') && req.method() === 'POST') {
    sseFrames.push({ msg: JSON.parse(req.postData() ?? '{}').message, blocks: [] })
  }
})

const messages = ['request gate 4', 'request gate 4 because need access']
for (const msg of messages) {
  console.log(`\n>>> typing: ${JSON.stringify(msg)}`)
  const before = captured.length
  await page.locator('textarea[placeholder^="tell me"]').fill(msg)
  await page.getByRole('button', { name: /^send$/i }).click()
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea[placeholder^="tell me"]')
      return ta && !ta.disabled && ta.value === ''
    },
    undefined,
    { timeout: 20000 },
  )
  await page.waitForTimeout(800)
  // Read what's actually painted in the DOM.
  const domState = await page.evaluate(() => {
    const surfaces = Array.from(document.querySelectorAll('.surface, [class*="rounded-xl"]'))
    return surfaces.slice(-6).map((el) => el.textContent?.trim().slice(0, 180))
  })
  console.log('   DOM tail:')
  for (const d of domState) console.log('     ·', d)
  // Take focused screenshot.
  const fname = msg.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  await page.screenshot({ path: `verify/out/probe-${fname}.png`, fullPage: false })
}

await browser.close()

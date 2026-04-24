import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('file:///' + join(__dirname, 'placeholder-preview.html').replace(/\\/g, '/'))
await page.waitForTimeout(400)
await page.screenshot({ path: join(__dirname, 'out', 'placeholder.png') })
console.log('wrote placeholder.png')
await browser.close()

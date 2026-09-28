// Launches the packaged app with an isolated profile and checks it over the Chrome DevTools
// Protocol: shell UI renders, first ChatGPT tab exists, a second tab can be opened, settings open.
// Usage: npm run smoke:package   (after npm run package)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const platformBinary = {
  darwin: join('release', `mac-${process.arch}`, 'ChatGPT Tabs.app', 'Contents', 'MacOS', 'ChatGPT Tabs'),
  win32: join('release', 'win-unpacked', 'ChatGPT Tabs.exe'),
  linux: join('release', 'linux-unpacked', 'chatgpt-tabs-desktop')
}[process.platform]

if (!platformBinary || !existsSync(platformBinary)) {
  console.error(`Packaged app not found at ${platformBinary}. Run "npm run package" first.`)
  process.exit(1)
}

const port = 9400 + Math.floor(Math.random() * 400)
const userData = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-smoke-'))
const child = spawn(platformBinary, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, CHATGPT_TABS_USER_DATA_DIR: userData },
  stdio: 'ignore'
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await sleep(500)
    }
  }
  throw new Error('could not connect to packaged app')
}

let exitCode = 0
try {
  const browser = await connect()
  check(child.exitCode === null, 'packaged app process is running')
  const pages = () => browser.contexts().flatMap((context) => context.pages())

  let ui
  for (let i = 0; i < 40 && !ui; i++) {
    ui = pages().find((page) => page.url().startsWith('file:') && page.url().includes('app.asar'))
    if (!ui) await sleep(250)
  }
  check(!!ui, 'shell UI loaded from app.asar')

  await ui.locator('[data-testid=tab]').first().waitFor({ timeout: 15000 })
  check((await ui.locator('[data-testid=tab]').count()) === 1, 'first tab created automatically')

  let tabPage
  for (let i = 0; i < 60 && !tabPage; i++) {
    tabPage = pages().find((page) => page.url().startsWith('https://chatgpt.com'))
    if (!tabPage) await sleep(500)
  }
  check(!!tabPage, `ChatGPT tab is loading ${tabPage?.url() ?? ''}`)
  await tabPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined)
  console.log(`   title: ${await tabPage.title()}`)

  await ui.locator('[data-testid=new-tab]').click()
  await ui.locator('[data-testid=tab]').nth(1).waitFor({ timeout: 10000 })
  check((await ui.locator('[data-testid=tab]').count()) === 2, 'second tab opened')

  await ui.locator('[data-testid=tab]').first().click()
  check((await ui.locator('[data-testid=tab]').first().getAttribute('data-active')) === 'true', 'switched back to first tab')

  await ui.locator('[data-testid=tab]').nth(1).locator('[data-testid=tab-close]').click()
  await sleep(300)
  check((await ui.locator('[data-testid=tab]').count()) === 1, 'tab closed')

  await ui.locator('[data-testid=settings-button]').click()
  await ui.locator('[data-testid=settings]').waitFor({ timeout: 5000 })
  check((await ui.locator('[data-testid=about-partition]').textContent()) === 'persist:chatgpt', 'settings open, persistent partition persist:chatgpt')

  if (process.env.SMOKE_SCREENSHOT) {
    await ui.locator('[data-testid=settings-close]').click()
    await sleep(3000)
    await tabPage.screenshot({ path: process.env.SMOKE_SCREENSHOT }).catch(() => undefined)
  }

  await browser.close().catch(() => undefined)
  console.log('package smoke test passed')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  exitCode = 1
} finally {
  child.kill()
  await sleep(1500)
  rmSync(userData, { recursive: true, force: true })
  process.exit(exitCode)
}

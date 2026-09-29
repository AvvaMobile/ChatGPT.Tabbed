// Captures the product screenshots used by the website (site/img) and the README.
//
// Launches the packaged macOS app with a throw-away profile, stages a few tabs over the Chrome
// DevTools Protocol and grabs the real window with `screencapture`. Nothing is sent to ChatGPT:
// prompts are only typed into the composer, never submitted, and no account is used.
//
// Usage (macOS, after `npm run package` or `npm run package:mac:signed`):
//   node scripts/capture-screenshots.mjs
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'site', 'img')
const binary = join(root, 'release', `mac-${process.arch}`, 'ChatGPT Tabs.app', 'Contents', 'MacOS', 'ChatGPT Tabs')
if (process.platform !== 'darwin' || !existsSync(binary)) {
  console.error('Run on macOS after packaging the app (release/mac-<arch>/ChatGPT Tabs.app).')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const work = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-shots-'))

// Small Swift helper: prints the CGWindowID of the app's largest on-screen window.
const swiftFile = join(work, 'winid.swift')
writeFileSync(
  swiftFile,
  `import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
let wins = list.filter { ($0[kCGWindowOwnerName as String] as? String) == "ChatGPT Tabs" && ($0[kCGWindowLayer as String] as? Int) == 0 }
let best = wins.max { a, b in
  let ra = a[kCGWindowBounds as String] as! [String: CGFloat], rb = b[kCGWindowBounds as String] as! [String: CGFloat]
  return ra["Width"]! * ra["Height"]! < rb["Width"]! * rb["Height"]!
}
if let id = best?[kCGWindowNumber as String] as? Int { print(id) }
`
)
const windowId = () => execFileSync('swift', [swiftFile], { encoding: 'utf8' }).trim()

function capture(name) {
  const id = windowId()
  if (!id) throw new Error('app window not found')
  const raw = join(work, `${name}.png`)
  execFileSync('screencapture', ['-x', '-o', `-l${id}`, raw])
  // 1600px wide keeps Retina sharpness at typical display sizes with reasonable file size.
  execFileSync('sips', ['--resampleWidth', '1600', raw, '--out', join(out, `${name}.png`)], { stdio: 'ignore' })
  console.log(`saved site/img/${name}.png`)
}

const port = 9500 + Math.floor(Math.random() * 300)
const app = spawn(binary, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, CHATGPT_TABS_USER_DATA_DIR: join(work, 'profile') },
  stdio: 'ignore'
})

let browser
try {
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null)
    if (!browser) await sleep(500)
  }
  if (!browser) throw new Error('could not connect to the app')
  const pages = () => browser.contexts().flatMap((c) => c.pages())
  const ui = pages().find((p) => p.url().includes('app.asar'))
  const tabPages = () => pages().filter((p) => p.url().startsWith('https://chatgpt.com'))

  async function waitForNewTabPage(known) {
    for (let i = 0; i < 80; i++) {
      const fresh = tabPages().find((p) => !known.includes(p))
      if (fresh) return fresh
      await sleep(250)
    }
    throw new Error('new tab page did not appear')
  }

  // ChatGPT renames its composer from time to time; match any of its known forms.
  const composer = (page) =>
    page.locator('#prompt-textarea, textarea#mobile-composer-prompt, main textarea, main [contenteditable="true"]').first()

  async function prepare(page, title, prompt) {
    await page.waitForLoadState('load').catch(() => undefined)
    await composer(page).waitFor({ timeout: 30000 })
    // Privacy-preserving choice on ChatGPT's cookie banner, if shown.
    await page.getByRole('button', { name: /reject non-essential/i }).click({ timeout: 4000 }).catch(() => undefined)
    // ChatGPT carries an unsent draft over to newly opened tabs; start from an empty composer.
    await composer(page).click()
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Backspace')
    if (prompt) await page.keyboard.type(prompt, { delay: 5 })
    // Name the tab with the app's own "rename tab" feature (double-click the tab).
    const tab = ui.locator('[data-testid=tab]').nth(tabIndex(page))
    await tab.dblclick()
    await ui.locator('[data-testid=tab-name-input]').fill(title)
    await ui.keyboard.press('Enter')
  }
  const tabIndex = (page) => known.indexOf(page)

  const known = []
  const staged = [
    ['Trip to Lisbon', 'Plan three relaxed days in Lisbon in October, with good food and short walks.'],
    ['Fix my SQL query', 'Why does my JOIN between orders and shipments return duplicate rows?'],
    ['Cover letter draft', 'Make my cover letter shorter and more direct.']
  ]

  await ui.locator('[data-testid=tab]').first().waitFor()
  for (let i = 0; i < staged.length; i++) {
    if (i > 0) await ui.locator('[data-testid=new-tab]').click()
    const page = i === 0 ? tabPages()[0] : await waitForNewTabPage(known)
    known.push(page)
    await prepare(page, staged[i][0], staged[i][1])
  }
  await ui.locator('[data-testid=tab]').first().click()
  await sleep(1500)
  capture('hero')

  // Renaming a tab: the inline editor on the second tab.
  await ui.locator('[data-testid=tab]').nth(1).dblclick()
  await ui.locator('[data-testid=tab-name-input]').fill('SQL: duplicate rows')
  await sleep(600)
  capture('rename')
  await ui.keyboard.press('Enter')
  await ui.locator('[data-testid=tab]').first().click()

  // Many tabs.
  const more = ['Explain transformers', 'Birthday ideas', 'Weekly meal plan', 'Regex for emails', 'Marathon training']
  for (const title of more) {
    await ui.locator('[data-testid=new-tab]').click()
    const page = await waitForNewTabPage(known)
    known.push(page)
    await prepare(page, title, '')
  }
  await ui.locator('[data-testid=tab]').nth(1).click()
  await sleep(1500)
  capture('many-tabs')

  // Dark appearance: ChatGPT and the tab bar both follow the system theme.
  const setScheme = async (page, value) => {
    if (page.isClosed()) return
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
  }
  const dark = (page) => setScheme(page, 'dark')
  await dark(ui)
  for (const page of known) await dark(page)
  await ui.locator('[data-testid=tab]').nth(0).click()
  await sleep(2000)
  capture('dark')

  // Settings.
  const light = (page) => setScheme(page, 'light')
  await light(ui)
  for (const page of known) await light(page)
  await ui.locator('[data-testid=settings-button]').click()
  await ui.locator('[data-testid=auth-status]').filter({ hasText: /signed in/i }).waitFor()
  await sleep(1000)
  capture('settings')
} finally {
  await browser?.close().catch(() => undefined)
  app.kill()
  await sleep(1500)
  rmSync(work, { recursive: true, force: true })
}

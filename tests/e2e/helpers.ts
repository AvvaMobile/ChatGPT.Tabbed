import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const projectRoot = resolve(__dirname, '../..')

export interface Harness {
  app: ElectronApplication
  ui: Page
  userDataDir: string
  cleanup(): Promise<void>
}

export interface TabViewInfo {
  id: number
  url: string
  bounds: { x: number; y: number; width: number; height: number }
}

/**
 * Launches the built app (out/) with an isolated profile directory, replaces network access to
 * chatgpt.com with a local stub page and records external-link opens instead of opening a browser.
 * No real ChatGPT account or network is needed.
 */
export async function launchApp(userDataDir?: string): Promise<Harness> {
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'chatgpt-tabs-e2e-'))
  const app = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, CHATGPT_TABS_USER_DATA_DIR: dir, NODE_ENV: 'production' }
  })
  await installStubs(app)

  const ui = await getUiPage(app)
  await expect(ui.getByTestId('tab')).toHaveCount(1)
  // Point the first tab at the stub now that interception is active.
  await app.evaluate(({ BrowserWindow, webContents }) => {
    const windowIds = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id))
    for (const wc of webContents.getAllWebContents()) {
      if (!windowIds.has(wc.id)) void wc.loadURL('https://chatgpt.com/')
    }
  })
  await expect(ui.getByTestId('tab').first()).toHaveAttribute('title', 'Stub /')

  return {
    app,
    ui,
    userDataDir: dir,
    async cleanup() {
      await app.close().catch(() => undefined)
      if (!userDataDir) rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function installStubs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session, shell }) => {
    const g = globalThis as unknown as { __hits: Record<string, number>; __fail: boolean; __opened: string[] }
    g.__hits = {}
    g.__fail = false
    g.__opened = []
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
    const ses = session.fromPartition('persist:chatgpt')
    ses.protocol.handle('https', (request) => {
      const url = new URL(request.url)
      if (g.__fail) return Response.error()
      if (url.hostname !== 'chatgpt.com') return new Response('not found', { status: 404 })
      g.__hits[url.pathname] = (g.__hits[url.pathname] ?? 0) + 1
      const html = `<!doctype html><html><head><title>Stub ${url.pathname}</title></head><body>
        <h1 id="path">${url.pathname}</h1>
        <a id="ext" href="https://example.com/ext">external</a>
        <a id="blank" target="_blank" href="https://example.org/blank">external blank</a>
        <a id="internal-new" target="_blank" href="https://chatgpt.com/c/opened">internal new window</a>
        <a id="conv" href="/c/conversation-2">conversation</a>
        <a id="file" href="file:///etc/hosts">file</a>
        </body></html>`
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    })
  })
}

export async function getUiPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((p) => p.url().startsWith('file:'))).toBe(true)
  const ui = app.windows().find((p) => p.url().startsWith('file:'))
  if (!ui) throw new Error('shell UI page not found')
  await ui.waitForLoadState('domcontentloaded')
  return ui
}

/** Playwright page for a ChatGPT tab, found by its path on the stub server. */
export async function getTabPage(app: ElectronApplication, path: string): Promise<Page> {
  const target = `https://chatgpt.com${path}`
  await expect.poll(() => app.windows().some((p) => p.url() === target)).toBe(true)
  const page = app.windows().find((p) => p.url() === target) as Page
  await page.waitForLoadState('load')
  // Wait until the document is scriptable (slow CI machines can still be swapping contexts).
  await expect(async () => {
    expect(await page.evaluate(() => document.readyState)).toBe('complete')
  }).toPass()
  return page
}

export async function clickMenu(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    type Item = Electron.MenuItem
    const find = (items: Item[]): Item | undefined => {
      for (const item of items) {
        if (item.label === wanted) return item
        const nested = item.submenu ? find(item.submenu.items) : undefined
        if (nested) return nested
      }
      return undefined
    }
    const menu = Menu.getApplicationMenu()
    const item = menu ? find(menu.items) : undefined
    if (!item) throw new Error(`menu item ${wanted} not found`)
    item.click()
  }, label)
}

/** Web contents of all ChatGPT tabs (everything that is not a top-level window's own contents). */
export async function tabContentsIds(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const windowIds = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id))
    return webContents
      .getAllWebContents()
      .filter((wc) => !windowIds.has(wc.id) && !wc.isDestroyed() && wc.getType() !== 'remote')
      .filter((wc) => !wc.getURL().startsWith('devtools:'))
      .map((wc) => wc.id)
  })
}

/** Views currently attached to the main window, with bounds. */
export async function attachedViews(app: ElectronApplication): Promise<TabViewInfo[]> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))
    if (!win) return []
    return win.contentView.children.map((child) => {
      const view = child as Electron.WebContentsView
      return { id: view.webContents.id, url: view.webContents.getURL(), bounds: view.getBounds() }
    })
  })
}

export async function mainContentSize(app: ElectronApplication): Promise<{ width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))
    const [width, height] = win ? win.getContentSize() : [0, 0]
    return { width, height }
  })
}

export async function openedExternally(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
}

export async function stubHits(app: ElectronApplication, path: string): Promise<number> {
  return app.evaluate((_electron, p) => (globalThis as unknown as { __hits: Record<string, number> }).__hits[p] ?? 0, path)
}

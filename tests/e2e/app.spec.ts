import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachedViews,
  clickInTab,
  clickMenu,
  getTabPage,
  launchApp,
  mainContentSize,
  openedExternally,
  stubHits,
  tabContentsIds,
  type Harness
} from './helpers'

const TOP_BAR = 40


let h: Harness

test.beforeEach(async () => {
  h = await launchApp()
})

test.afterEach(async () => {
  await h.cleanup()
})

test('opens with one ChatGPT tab attached below the tab bar', async () => {
  const { app, ui } = h
  await expect(ui.getByTestId('tab')).toHaveCount(1)
  await expect(ui.getByTestId('tab').first()).toHaveAttribute('data-active', 'true')
  expect(await tabContentsIds(app)).toHaveLength(1)

  const views = await attachedViews(app)
  expect(views).toHaveLength(1)
  expect(views[0].url).toBe('https://chatgpt.com/')
  const size = await mainContentSize(app)
  expect(views[0].bounds).toEqual({ x: 0, y: TOP_BAR, width: size.width, height: size.height - TOP_BAR })
})

test('every tab uses its own web contents on the shared persistent partition with secure prefs', async () => {
  const { app, ui } = h
  await ui.getByTestId('new-tab').click()
  await ui.getByTestId('new-tab').click()
  await expect(ui.getByTestId('tab')).toHaveCount(3)

  const ids = await tabContentsIds(app)
  expect(new Set(ids).size).toBe(3)

  const result = await app.evaluate(({ session, webContents }, tabIds) => {
    const shared = session.fromPartition('persist:chatgpt')
    return tabIds.map((id) => {
      const wc = webContents.fromId(id)!
      const prefs = (wc as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences()
      return {
        sameSession: wc.session === shared,
        persistent: shared.isPersistent(),
        storagePath: shared.storagePath ?? '',
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
        preload: prefs.preload ?? null
      }
    })
  }, ids)

  for (const tab of result) {
    expect(tab.sameSession).toBe(true)
    expect(tab.persistent).toBe(true)
    expect(tab.storagePath).toMatch(/Partitions[\\/]chatgpt$/)
    expect(tab.sandbox).toBe(true)
    expect(tab.contextIsolation).toBe(true)
    expect(tab.nodeIntegration).toBe(false)
    expect(tab.preload).toBeNull()
  }

  // Remote pages get neither Node nor the shell bridge.
  const page = await getTabPage(app, '/')
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: typeof (window as unknown as { chatgptTabs?: unknown }).chatgptTabs
  }))
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', bridge: 'undefined' })
})

test('new tabs start clean, switching preserves per-tab navigation state', async () => {
  const { app, ui } = h
  const tabs = ui.getByTestId('tab')

  // Tab 1 navigates to a conversation.
  await clickInTab(app, '#conv')
  await expect(tabs.nth(0)).toHaveAttribute('data-title', 'Stub /c/conversation-2')

  // New tab does not clone the active URL.
  await ui.getByTestId('new-tab').click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')
  await expect(tabs.nth(1)).toHaveAttribute('data-title', 'Stub /')
  const [viewAfterNew] = await attachedViews(app)
  expect(viewAfterNew.url).toBe('https://chatgpt.com/')

  // Switch back: tab 1 still shows its conversation, only one view attached.
  await tabs.nth(0).click()
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  let views = await attachedViews(app)
  expect(views).toHaveLength(1)
  expect(views[0].url).toBe('https://chatgpt.com/c/conversation-2')
  expect(await tabContentsIds(app)).toHaveLength(2)

  // And tab 2 is untouched.
  await tabs.nth(1).click()
  views = await attachedViews(app)
  expect(views[0].url).toBe('https://chatgpt.com/')

  // Back/forward controls act on the active tab only.
  await tabs.nth(0).click()
  await ui.getByRole('button', { name: 'Back' }).click()
  await expect(tabs.nth(0)).toHaveAttribute('data-title', 'Stub /')
  await expect(tabs.nth(1)).toHaveAttribute('data-title', 'Stub /')
})

test('menu shortcuts: new tab, select by number, next/previous, close', async () => {
  const { app, ui } = h
  const tabs = ui.getByTestId('tab')

  const accelerators = await app.evaluate(({ Menu }) => {
    const out: Record<string, string> = {}
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator && item.label) out[item.label] = String(item.accelerator)
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu()!.items)
    return out
  })
  expect(accelerators['New Tab']).toBe('CmdOrCtrl+T')
  expect(accelerators['Close Tab']).toBe('CmdOrCtrl+W')
  expect(accelerators['Reload Tab']).toBe('CmdOrCtrl+R')
  expect(accelerators['Select Tab 1']).toBe('CmdOrCtrl+1')
  expect(accelerators['Select Last Tab']).toBe('CmdOrCtrl+9')

  await clickMenu(app, 'New Tab')
  await clickMenu(app, 'New Tab')
  await expect(tabs).toHaveCount(3)
  await expect(tabs.nth(2)).toHaveAttribute('data-active', 'true')

  await clickMenu(app, 'Select Tab 1')
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  await clickMenu(app, 'Select Last Tab')
  await expect(tabs.nth(2)).toHaveAttribute('data-active', 'true')
  await clickMenu(app, 'Next Tab')
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  await clickMenu(app, 'Previous Tab')
  await expect(tabs.nth(2)).toHaveAttribute('data-active', 'true')

  await clickMenu(app, 'Close Tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')
})

test('closing tabs destroys their web contents; closing the last tab opens a fresh one', async () => {
  const { app, ui } = h
  const tabs = ui.getByTestId('tab')
  await ui.getByTestId('new-tab').click()
  await expect(tabs).toHaveCount(2)
  const before = await tabContentsIds(app)
  expect(before).toHaveLength(2)

  // Close the active (second) tab via its close button -> first becomes active.
  await tabs.nth(1).hover()
  await tabs.nth(1).getByTestId('tab-close').click()
  await expect(tabs).toHaveCount(1)
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  await expect.poll(() => tabContentsIds(app)).toHaveLength(1)
  const remaining = await tabContentsIds(app)
  const closedId = before.find((id) => !remaining.includes(id))!
  await expect
    .poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, closedId))
    .toBe(true)

  // Close the last tab -> app stays open with a brand-new tab.
  const lastId = (await tabContentsIds(app))[0]
  await tabs.nth(0).getByTestId('tab-close').click()
  await expect(tabs).toHaveCount(1)
  await expect.poll(async () => (await tabContentsIds(app))[0]).not.toBe(lastId)
  await expect.poll(() => tabContentsIds(app)).toHaveLength(1)
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  const views = await attachedViews(app)
  expect(views).toHaveLength(1)
})

test('reload button and menu reload the active tab', async () => {
  const { app, ui } = h
  const before = await stubHits(app, '/')
  await ui.getByTestId('reload').click()
  await expect.poll(() => stubHits(app, '/')).toBe(before + 1)
  await clickMenu(app, 'Reload Tab')
  await expect.poll(() => stubHits(app, '/')).toBe(before + 2)
})

test('settings screen opens, hides the ChatGPT view and shows session info', async () => {
  const { app, ui } = h
  await ui.getByTestId('settings-button').click()
  await expect(ui.getByTestId('settings')).toBeVisible()
  await expect(ui.getByTestId('open-login')).toHaveText('Open ChatGPT Login')
  await expect(ui.getByTestId('clear-session')).toBeVisible()
  await expect(ui.getByTestId('about-partition')).toHaveText('persist:chatgpt')
  await expect(ui.getByTestId('auth-status')).toHaveText('Not signed in')
  expect(await attachedViews(app)).toHaveLength(0)

  await ui.keyboard.press('Escape')
  await expect(ui.getByTestId('settings')).toHaveCount(0)
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1)

  // Selecting a tab also leaves settings.
  await ui.getByTestId('settings-button').click()
  await expect(ui.getByTestId('settings')).toBeVisible()
  await ui.getByTestId('tab').first().click()
  await expect(ui.getByTestId('settings')).toHaveCount(0)
})

test('login window uses the shared persistent session and cleans up on close', async () => {
  const { app, ui } = h
  await ui.getByTestId('settings-button').click()
  await ui.getByTestId('open-login').click()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
  await expect(ui.getByTestId('open-login')).toHaveText('Show Login Window')

  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Sign in to ChatGPT')?.webContents.getURL()
      )
    )
    .toBe('https://chatgpt.com/auth/login')
  const info = await app.evaluate(({ BrowserWindow, session }) => {
    const login = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Sign in to ChatGPT')!
    const prefs = (login.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences()
    return {
      sameSession: login.webContents.session === session.fromPartition('persist:chatgpt'),
      url: login.webContents.getURL(),
      sandbox: prefs.sandbox,
      nodeIntegration: prefs.nodeIntegration
    }
  })
  expect(info.sameSession).toBe(true)
  expect(info.url).toBe('https://chatgpt.com/auth/login')
  expect(info.sandbox).toBe(true)
  expect(info.nodeIntegration).toBe(false)

  // Simulate a successful sign-in: session cookie appears, page lands on the app root.
  const hitsBefore = await stubHits(app, '/')
  await app.evaluate(async ({ BrowserWindow, session }) => {
    const ses = session.fromPartition('persist:chatgpt')
    await ses.cookies.set({
      url: 'https://chatgpt.com',
      name: '__Secure-next-auth.session-token',
      value: 'test',
      secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 3600
    })
    const login = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Sign in to ChatGPT')!
    // Let the initial login page finish first so the next navigation does not abort it (-3).
    if (login.webContents.isLoading()) {
      await new Promise<void>((done) => login.webContents.once('did-stop-loading', () => done()))
    }
    await login.webContents.loadURL('https://chatgpt.com/')
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect.poll(() => stubHits(app, '/')).toBeGreaterThan(hitsBefore + 1) // login page + reloaded tab
  await ui.getByTestId('settings-button').click()
  await expect(ui.getByTestId('auth-status')).toHaveText('Signed in')
})

test('clear session removes cookies and storage and resets tabs', async () => {
  const { app, ui } = h
  await app.evaluate(async ({ session, dialog }) => {
    await session.fromPartition('persist:chatgpt').cookies.set({
      url: 'https://chatgpt.com',
      name: '__Secure-next-auth.session-token',
      value: 'test',
      secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 3600
    })
    // Auto-confirm the native confirmation dialog.
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  const first = await getTabPage(app, '/')
  await expect(async () => {
    await first.evaluate(() => localStorage.setItem('probe', '1'))
  }).toPass()
  await clickInTab(app, '#conv')

  await ui.getByTestId('settings-button').click()
  await expect(ui.getByTestId('auth-status')).toHaveText('Signed in')
  await ui.getByTestId('clear-session').click()
  await expect(ui.getByText('ChatGPT session cleared')).toBeVisible()
  await expect(ui.getByTestId('auth-status')).toHaveText('Not signed in')

  const cookies = await app.evaluate(({ session }) => session.fromPartition('persist:chatgpt').cookies.get({}))
  expect(cookies).toHaveLength(0)

  await ui.getByTestId('tab').first().click()
  const page = await getTabPage(app, '/')
  expect(await page.evaluate(() => localStorage.getItem('probe'))).toBeNull()
})

test('external links open in the system browser; ChatGPT popups become tabs; file: is blocked', async () => {
  const { app, ui } = h
  // Cancelled cross-site navigations may swap the renderer target, so re-resolve the page each time.
  const tabUrl = async () => (await attachedViews(app))[0]?.url

  await clickInTab(app, '#ext')
  await expect.poll(() => openedExternally(app)).toContain('https://example.com/ext')
  expect(await tabUrl()).toBe('https://chatgpt.com/')

  await clickInTab(app, '#blank')
  await expect.poll(() => openedExternally(app)).toContain('https://example.org/blank')

  await clickInTab(app, '#file')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(await openedExternally(app)).not.toContain('file:///etc/hosts')

  // Still on the ChatGPT page; nothing navigated inside the app.
  expect(await tabUrl()).toBe('https://chatgpt.com/')
  await expect(ui.getByTestId('tab')).toHaveCount(1)

  await clickInTab(app, '#internal-new')
  await expect(ui.getByTestId('tab')).toHaveCount(2)
  await expect(ui.getByTestId('tab').nth(1)).toHaveAttribute('data-title', 'Stub /c/opened')

  // A navigation to an external site initiated by script is diverted too.
  await getTabPage(app, '/').then((p) => p.evaluate(() => (location.href = 'https://example.net/js')))
  await expect.poll(() => openedExternally(app)).toContain('https://example.net/js')
})

test('view bounds follow window resizes', async () => {
  const { app } = h
  for (const [w, h2] of [
    [900, 640],
    [1400, 900],
    [700, 480]
  ]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('file:'))!
      win.setContentSize(size[0], size[1])
    }, [w, h2])
    const size = await mainContentSize(app)
    await expect
      .poll(async () => (await attachedViews(app))[0]?.bounds)
      .toEqual({ x: 0, y: TOP_BAR, width: size.width, height: size.height - TOP_BAR })
  }
})

test('failed loads show an error state with a working retry', async () => {
  const { app, ui } = h
  await app.evaluate(() => {
    ;(globalThis as unknown as { __fail: boolean }).__fail = true
  })
  await ui.getByTestId('reload').click()
  await expect(ui.getByTestId('status-panel')).toBeVisible()
  await expect(ui.getByTestId('retry')).toHaveText('Retry')
  expect(await attachedViews(app)).toHaveLength(0)

  await app.evaluate(() => {
    ;(globalThis as unknown as { __fail: boolean }).__fail = false
  })
  await ui.getByTestId('retry').click()
  await expect(ui.getByTestId('status-panel')).toHaveCount(0)
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1)
  await expect(ui.getByTestId('tab').first()).toHaveAttribute('data-title', 'Stub /')
})

test('a crashed tab offers recovery', async () => {
  const { app, ui } = h
  await app.evaluate(({ BrowserWindow, webContents }) => {
    const windowIds = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id))
    webContents.getAllWebContents().find((wc) => !windowIds.has(wc.id))!.forcefullyCrashRenderer()
  })
  await expect(ui.getByTestId('status-panel')).toBeVisible()
  await expect(ui.getByTestId('retry')).toHaveText('Reload tab')
  await ui.getByTestId('retry').click()
  await expect(ui.getByTestId('status-panel')).toHaveCount(0)
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1)
})

test('IPC rejects malformed input', async () => {
  const { ui } = h
  const outcome = await ui.evaluate(async () => {
    try {
      await window.chatgptTabs.activateTab('../../etc')
      return 'accepted'
    } catch {
      return 'rejected'
    }
  })
  expect(outcome).toBe('rejected')
  const keys = await ui.evaluate(() => Object.keys(window.chatgptTabs).sort())
  expect(keys).not.toContain('invoke')
  expect(keys).not.toContain('send')
})

test('closing the window destroys every tab web contents; dock re-open brings the tabs back', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app alive without windows')
  const { app, ui } = h
  await ui.getByTestId('new-tab').click()
  await ui.getByTestId('new-tab').click()
  await expect(ui.getByTestId('tab')).toHaveCount(3)
  expect(await tabContentsIds(app)).toHaveLength(3)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().length)).toBe(0)

  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'))
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  // Tabs are restored (restore is on by default); only the active one is loaded.
  await expect.poll(() => tabContentsIds(app)).toHaveLength(3)
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1)
})

test.describe('persistence', () => {
  test('cookies survive an app restart on the same partition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-persist-'))
    try {
      const first = await launchApp(dir)
      await first.app.evaluate(async ({ session }) => {
        const ses = session.fromPartition('persist:chatgpt')
        await ses.cookies.set({
          url: 'https://chatgpt.com',
          name: 'persist-probe',
          value: '1',
          secure: true,
          expirationDate: Math.floor(Date.now() / 1000) + 3600
        })
      })
      await first.cleanup()

      const second = await launchApp(dir)
      const names = await second.app.evaluate(async ({ session }) =>
        (await session.fromPartition('persist:chatgpt').cookies.get({ name: 'persist-probe' })).map((c) => c.name)
      )
      expect(names).toEqual(['persist-probe'])
      await second.cleanup()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

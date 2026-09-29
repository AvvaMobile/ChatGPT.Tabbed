import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachedViews, clickMenu, launchApp, mainContentSize, tabContentsIds, type Harness } from './helpers'

const TOP_BAR = 40

const DIVIDER = 6

function expectedSplit(size: { width: number; height: number }) {
  const leftWidth = Math.floor((size.width - DIVIDER) / 2)
  return [
    { x: 0, y: TOP_BAR, width: leftWidth, height: size.height - TOP_BAR },
    { x: leftWidth + DIVIDER, y: TOP_BAR, width: size.width - leftWidth - DIVIDER, height: size.height - TOP_BAR }
  ]
}

async function sortedBounds(app: Harness['app']) {
  return (await attachedViews(app)).map((view) => view.bounds).sort((a, b) => a.x - b.x)
}

async function fullWidth(app: Harness['app']) {
  const size = await mainContentSize(app)
  return [{ x: 0, y: TOP_BAR, width: size.width, height: size.height - TOP_BAR }]
}

test.describe('split view', () => {
  let h: Harness
  test.beforeEach(async () => {
    h = await launchApp()
  })
  test.afterEach(async () => {
    await h.cleanup()
  })

  test('opens a right column with its own tab strip and merges back when turned off', async () => {
    const { app, ui } = h
    await ui.getByTestId('new-tab').click()
    await expect(ui.getByTestId('tab')).toHaveCount(2)

    await ui.getByTestId('split-button').click()
    const left = ui.getByTestId('tab-strip-0').getByTestId('tab')
    const right = ui.getByTestId('tab-strip-1').getByTestId('tab')
    await expect(ui.getByTestId('split')).toBeVisible()
    await expect(left).toHaveCount(2)
    await expect(right).toHaveCount(1)
    await expect(right.first()).toHaveAttribute('data-active', 'true')
    await expect(right.first()).toHaveAttribute('data-pane', 'right')
    await expect(left.nth(1)).toHaveAttribute('data-pane', 'left')
    await expect.poll(() => sortedBounds(app)).toEqual(expectedSplit(await mainContentSize(app)))

    await ui.getByTestId('split-button').click()
    await expect(ui.getByTestId('split')).toHaveCount(0)
    await expect(ui.getByTestId('tab-strip-1')).toHaveCount(0)
    await expect(ui.getByTestId('tab-strip-0').getByTestId('tab')).toHaveCount(3)
    await expect.poll(() => sortedBounds(app)).toEqual(await fullWidth(app))
  })

  test('each column manages its own tabs', async () => {
    const { app, ui } = h
    await ui.getByTestId('split-button').click()
    const left = ui.getByTestId('tab-strip-0').getByTestId('tab')
    const right = ui.getByTestId('tab-strip-1').getByTestId('tab')
    await expect(right).toHaveCount(1)

    // "+" of the right column adds a tab there; the left column is untouched.
    await ui.getByTestId('new-tab-right').click()
    await expect(right).toHaveCount(2)
    await expect(left).toHaveCount(1)
    await expect(right.nth(1)).toHaveAttribute('data-active', 'true')
    await expect(left.first()).toHaveAttribute('data-pane', 'left')

    // Switching tabs inside the right column keeps the left column as it is.
    await right.first().click()
    await expect(right.first()).toHaveAttribute('data-pane', 'right')
    await expect(right.nth(1)).not.toHaveAttribute('data-pane', /.+/)
    await expect(left.first()).toHaveAttribute('data-pane', 'left')
    expect(await attachedViews(app)).toHaveLength(2)

    // Cmd/Ctrl+number and Cmd/Ctrl+T act on the focused column.
    await clickMenu(app, 'Select Tab 2')
    await expect(right.nth(1)).toHaveAttribute('data-active', 'true')
    await clickMenu(app, 'New Tab')
    await expect(right).toHaveCount(3)
    await left.first().click()
    await expect(left.first()).toHaveAttribute('data-active', 'true')
    await clickMenu(app, 'New Tab')
    await expect(left).toHaveCount(2)
    await expect(right).toHaveCount(3)
  })

  test('clicking into a column focuses it', async () => {
    const { app, ui } = h
    await ui.getByTestId('split-button').click()
    const left = ui.getByTestId('tab-strip-0').getByTestId('tab')
    await expect(ui.getByTestId('tab-strip-1').getByTestId('tab').first()).toHaveAttribute('data-active', 'true')

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!
      const leftView = win.contentView.children
        .map((child) => child as Electron.WebContentsView)
        .sort((a, b) => a.getBounds().x - b.getBounds().x)[0]
      leftView.webContents.focus()
    })
    await expect(left.first()).toHaveAttribute('data-active', 'true')
  })

  test('a tab can move to the other side; closing the last tab of a column ends split view', async () => {
    const { app, ui } = h
    await ui.getByTestId('new-tab').click()
    await ui.getByTestId('tab').first().click()
    await clickMenu(app, 'Move Tab to Other Side')
    const left = ui.getByTestId('tab-strip-0').getByTestId('tab')
    const right = ui.getByTestId('tab-strip-1').getByTestId('tab')
    await expect(left).toHaveCount(1)
    await expect(right).toHaveCount(1)
    await expect(right.first()).toHaveAttribute('data-active', 'true')

    await right.first().getByTestId('tab-close').click()
    await expect(ui.getByTestId('split')).toHaveCount(0)
    await expect(ui.getByTestId('tab')).toHaveCount(1)
    expect(await tabContentsIds(app)).toHaveLength(1)
    await expect.poll(() => sortedBounds(app)).toEqual(await fullWidth(app))
  })

  test('panes follow resizes, Settings hides both, and the shortcut toggles split view', async () => {
    const { app, ui } = h
    const accelerator = await app.evaluate(({ Menu }) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.label === 'Toggle Split View') return item
          const nested = item.submenu ? find(item.submenu.items) : undefined
          if (nested) return nested
        }
        return undefined
      }
      return String(find(Menu.getApplicationMenu()!.items)?.accelerator)
    })
    expect(accelerator).toBe('CmdOrCtrl+\\')

    await clickMenu(app, 'Toggle Split View')
    await expect(ui.getByTestId('split')).toBeVisible()
    for (const [w, hgt] of [
      [1001, 700],
      [1400, 900]
    ]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((x) => x.webContents.getURL().startsWith('file:'))!
          .setContentSize(size[0], size[1])
      }, [w, hgt])
      await expect.poll(async () => sortedBounds(app)).toEqual(expectedSplit(await mainContentSize(app)))
    }

    await ui.getByTestId('settings-button').click()
    await expect(ui.getByTestId('settings')).toBeVisible()
    await expect.poll(async () => (await attachedViews(app)).length).toBe(0)
    await ui.keyboard.press('Escape')
    await expect(ui.getByTestId('settings')).toHaveCount(0)
    await expect.poll(async () => (await attachedViews(app)).length).toBe(2)
  })
})

test('both columns and their tabs are restored after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-split-'))
  try {
    const first = await launchApp(dir)
    await first.ui.getByTestId('split-button').click()
    await first.ui.getByTestId('new-tab-right').click()
    await expect(first.ui.getByTestId('tab-strip-1').getByTestId('tab')).toHaveCount(2)
    await first.cleanup()

    const saved = JSON.parse(readFileSync(join(dir, 'tabs.json'), 'utf8'))
    expect(saved.split).toEqual({ left: 0, right: 2 })
    expect(saved.tabs.map((tab: { group: number }) => tab.group)).toEqual([0, 1, 1])

    const second = await launchApp(dir, { expectTabs: 3, resetToHome: false })
    await expect(second.ui.getByTestId('split')).toBeVisible()
    await expect(second.ui.getByTestId('tab-strip-0').getByTestId('tab')).toHaveCount(1)
    await expect(second.ui.getByTestId('tab-strip-1').getByTestId('tab')).toHaveCount(2)
    await expect(second.ui.getByTestId('tab-strip-1').getByTestId('tab').nth(1)).toHaveAttribute('data-active', 'true')
    await expect.poll(async () => (await attachedViews(second.app)).length).toBe(2)
    // Only the two visible tabs are loaded.
    const loaded = await second.app.evaluate(({ BrowserWindow, webContents }) => {
      const windowIds = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id))
      return webContents.getAllWebContents().filter((wc) => !windowIds.has(wc.id) && wc.getURL() !== '').length
    })
    expect(loaded).toBe(2)
    await second.cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

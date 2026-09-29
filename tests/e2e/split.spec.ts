import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachedViews, clickMenu, launchApp, mainContentSize, tabContentsIds, type Harness } from './helpers'

const TOP_BAR = 40

function expectedSplit(size: { width: number; height: number }) {
  const width = size.width
  const leftWidth = Math.floor((width - 1) / 2)
  return [
    { x: 0, y: TOP_BAR, width: leftWidth, height: size.height - TOP_BAR },
    { x: leftWidth + 1, y: TOP_BAR, width: width - leftWidth - 1, height: size.height - TOP_BAR }
  ]
}

async function sortedBounds(app: Harness['app']) {
  return (await attachedViews(app)).map((view) => view.bounds).sort((a, b) => a.x - b.x)
}

test.describe('split view', () => {
  let h: Harness
  test.beforeEach(async () => {
    h = await launchApp()
  })
  test.afterEach(async () => {
    await h.cleanup()
  })

  test('with a single tab, split view opens a new chat on the right and closes again', async () => {
    const { app, ui } = h
    const tabs = ui.getByTestId('tab')
    await ui.getByTestId('split-button').click()

    await expect(tabs).toHaveCount(2)
    await expect(ui.getByTestId('split-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(ui.getByTestId('split')).toBeVisible()
    await expect(tabs.nth(0)).toHaveAttribute('data-pane', 'left')
    await expect(tabs.nth(1)).toHaveAttribute('data-pane', 'right')
    // The new chat on the right gets the focus.
    await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')

    await expect.poll(() => sortedBounds(app)).toEqual(expectedSplit(await mainContentSize(app)))

    await ui.getByTestId('split-button').click()
    await expect(ui.getByTestId('split')).toHaveCount(0)
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(1)).not.toHaveAttribute('data-pane', /.+/)
    const size = await mainContentSize(app)
    await expect
      .poll(() => sortedBounds(app))
      .toEqual([{ x: 0, y: TOP_BAR, width: size.width, height: size.height - TOP_BAR }])
  })

  test('uses the neighbouring tab, and a tab picked in the tab bar replaces the focused pane', async () => {
    const { ui } = h
    const tabs = ui.getByTestId('tab')
    await ui.getByTestId('new-tab').click()
    await ui.getByTestId('new-tab').click()
    await expect(tabs).toHaveCount(3)

    await tabs.nth(0).click()
    await ui.getByTestId('split-button').click()
    await expect(tabs.nth(0)).toHaveAttribute('data-pane', 'left')
    await expect(tabs.nth(1)).toHaveAttribute('data-pane', 'right')
    await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
    await expect(tabs).toHaveCount(3)

    // Tab 3 goes into the focused (left) pane; tab 2 stays on the right.
    await tabs.nth(2).click()
    await expect(tabs.nth(2)).toHaveAttribute('data-pane', 'left')
    await expect(tabs.nth(2)).toHaveAttribute('data-active', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('data-pane', 'right')
    await expect(tabs.nth(0)).not.toHaveAttribute('data-pane', /.+/)
  })

  test('focusing a pane makes its tab active', async () => {
    const { app, ui } = h
    const tabs = ui.getByTestId('tab')
    await ui.getByTestId('split-button').click()
    await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')

    // Focus the left pane's page directly, as a click into it would.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!
      const left = win.contentView.children
        .map((child) => child as Electron.WebContentsView)
        .sort((a, b) => a.getBounds().x - b.getBounds().x)[0]
      left.webContents.focus()
    })
    await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
    await expect(tabs.nth(0)).toHaveAttribute('data-pane', 'left')
  })

  test('closing one of the split tabs leaves the other full width', async () => {
    const { app, ui } = h
    const tabs = ui.getByTestId('tab')
    await ui.getByTestId('split-button').click()
    await expect(tabs).toHaveCount(2)
    await tabs.nth(1).getByTestId('tab-close').click()
    await expect(tabs).toHaveCount(1)
    await expect(ui.getByTestId('split-button')).toHaveAttribute('aria-pressed', 'false')
    expect(await tabContentsIds(app)).toHaveLength(1)
    const size = await mainContentSize(app)
    await expect
      .poll(() => sortedBounds(app))
      .toEqual([{ x: 0, y: TOP_BAR, width: size.width, height: size.height - TOP_BAR }])
  })

  test('split panes follow window resizes and the menu shortcut toggles split view', async () => {
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

    // Settings hides both panes.
    await ui.getByTestId('settings-button').click()
    await expect.poll(async () => (await attachedViews(app)).length).toBe(0)
    await ui.keyboard.press('Escape')
    await expect.poll(async () => (await attachedViews(app)).length).toBe(2)
  })
})

test('split view is restored after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-split-'))
  try {
    const first = await launchApp(dir)
    await first.ui.getByTestId('split-button').click()
    await expect(first.ui.getByTestId('tab')).toHaveCount(2)
    await first.cleanup()

    const saved = JSON.parse(readFileSync(join(dir, 'tabs.json'), 'utf8'))
    expect(saved.split).toEqual({ left: 0, right: 1 })

    const second = await launchApp(dir, { expectTabs: 2, resetToHome: false })
    await expect(second.ui.getByTestId('split')).toBeVisible()
    await expect(second.ui.getByTestId('tab').nth(0)).toHaveAttribute('data-pane', 'left')
    await expect(second.ui.getByTestId('tab').nth(1)).toHaveAttribute('data-pane', 'right')
    await expect.poll(async () => (await attachedViews(second.app)).length).toBe(2)
    await second.cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clickMenu, getTabPage, launchApp, type Harness } from './helpers'

async function clickInTab(app: Harness['app'], selector: string, path = '/'): Promise<void> {
  const page = await getTabPage(app, path)
  await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).click(), selector)
}

function readSavedTabs(dir: string): { activeIndex: number; tabs: Array<{ url: string; title: string; customTitle: string | null }> } {
  return JSON.parse(readFileSync(join(dir, 'tabs.json'), 'utf8'))
}

test.describe('tab names', () => {
  let h: Harness
  test.beforeEach(async () => {
    h = await launchApp()
  })
  test.afterEach(async () => {
    await h.cleanup()
  })

  test('double-click renames a tab; the name survives page title changes and can be reset', async () => {
    const { app, ui } = h
    const tab = ui.getByTestId('tab').first()

    await tab.dblclick()
    const input = ui.getByTestId('tab-name-input')
    await expect(input).toBeFocused()
    await input.fill('  Project   notes  ')
    await input.press('Enter')
    await expect(tab).toHaveAttribute('data-title', 'Project notes')
    await expect(tab).toHaveAttribute('data-renamed', 'true')

    // The page navigates and changes its own title; the custom name stays.
    await clickInTab(app, '#conv')
    await getTabPage(app, '/c/conversation-2')
    await expect(tab).toHaveAttribute('data-title', 'Project notes')

    // Escape cancels an edit.
    await tab.dblclick()
    await ui.getByTestId('tab-name-input').fill('Discarded')
    await ui.getByTestId('tab-name-input').press('Escape')
    await expect(tab).toHaveAttribute('data-title', 'Project notes')

    // Clearing the name restores the page title.
    await tab.dblclick()
    await ui.getByTestId('tab-name-input').fill('')
    await ui.getByTestId('tab-name-input').press('Enter')
    await expect(tab).toHaveAttribute('data-title', 'Stub /c/conversation-2')
    await expect(tab).toHaveAttribute('data-renamed', 'false')
  })

  test('"Rename Tab…" in the menu opens the editor for the active tab', async () => {
    const { app, ui } = h
    await ui.getByTestId('new-tab').click()
    await expect(ui.getByTestId('tab')).toHaveCount(2)
    await clickMenu(app, 'Rename Tab…')
    const input = ui.getByTestId('tab-name-input')
    await expect(input).toBeVisible()
    await input.fill('Second')
    await input.press('Enter')
    await expect(ui.getByTestId('tab').nth(1)).toHaveAttribute('data-title', 'Second')
    await expect(ui.getByTestId('tab').nth(0)).toHaveAttribute('data-renamed', 'false')
  })

  test('rename IPC rejects bad input', async () => {
    const { ui } = h
    const results = await ui.evaluate(async () => {
      const attempt = async (fn: () => Promise<unknown>) => {
        try {
          await fn()
          return 'ok'
        } catch {
          return 'rejected'
        }
      }
      return [
        await attempt(() => window.chatgptTabs.renameTab('tab-x', 'a')),
        await attempt(() => window.chatgptTabs.renameTab('tab-1', 42 as unknown as string)),
        await attempt(() => window.chatgptTabs.renameTab('tab-1', 'x'.repeat(10_000)))
      ]
    })
    expect(results).toEqual(['rejected', 'rejected', 'rejected'])
  })
})

test.describe('restoring tabs', () => {
  test('tabs, names and the active tab come back after a restart; background tabs load on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-restore-'))
    try {
      const first = await launchApp(dir)
      const { ui } = first

      // Tab 1: a conversation. Tab 2: renamed and active at quit.
      await clickInTab(first.app, '#conv')
      await expect(ui.getByTestId('tab').first()).toHaveAttribute('data-title', 'Stub /c/conversation-2')
      await ui.getByTestId('new-tab').click()
      await expect(ui.getByTestId('tab')).toHaveCount(2)
      // Wait for the page's own title so it is part of the saved state.
      await expect(ui.getByTestId('tab').nth(1)).toHaveAttribute('data-title', 'Stub /')
      await ui.getByTestId('tab').nth(1).dblclick()
      await ui.getByTestId('tab-name-input').fill('Pinned')
      await ui.getByTestId('tab-name-input').press('Enter')
      await expect(ui.getByTestId('tab').nth(1)).toHaveAttribute('data-title', 'Pinned')
      await first.cleanup()

      const saved = readSavedTabs(dir)
      expect(saved.activeIndex).toBe(1)
      expect(saved.tabs).toEqual([
        { url: 'https://chatgpt.com/c/conversation-2', title: 'Stub /c/conversation-2', customTitle: null },
        { url: 'https://chatgpt.com/', title: 'Stub /', customTitle: 'Pinned' }
      ])

      const second = await launchApp(dir, { expectTabs: 2, resetToHome: false })
      const tabs = second.ui.getByTestId('tab')
      await expect(tabs.nth(0)).toHaveAttribute('data-title', 'Stub /c/conversation-2')
      await expect(tabs.nth(1)).toHaveAttribute('data-title', 'Pinned')
      await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')

      // The background tab has not loaded anything yet.
      const urls = await second.app.evaluate(({ BrowserWindow, webContents }) => {
        const windowIds = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id))
        return webContents
          .getAllWebContents()
          .filter((wc) => !windowIds.has(wc.id))
          .map((wc) => wc.getURL())
      })
      expect(urls).toContain('')

      // Showing it opens the saved conversation.
      await tabs.nth(0).click()
      const page = await getTabPage(second.app, '/c/conversation-2')
      expect(page.url()).toBe('https://chatgpt.com/c/conversation-2')
      await second.cleanup()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('turning the setting off forgets saved tabs and starts with one new tab', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-norestore-'))
    try {
      const first = await launchApp(dir)
      await first.ui.getByTestId('new-tab').click()
      await first.ui.getByTestId('settings-button').click()
      const toggle = first.ui.getByTestId('restore-tabs')
      await expect(toggle).toBeChecked()
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect.poll(() => existsSync(join(dir, 'tabs.json'))).toBe(false)
      await first.cleanup()
      expect(existsSync(join(dir, 'tabs.json'))).toBe(false)

      const second = await launchApp(dir)
      await expect(second.ui.getByTestId('tab')).toHaveCount(1)
      await second.cleanup()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('clearing the ChatGPT session also forgets conversation links and tab names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-clear-'))
    try {
      const h = await launchApp(dir)
      await h.ui.getByTestId('tab').first().dblclick()
      await h.ui.getByTestId('tab-name-input').fill('Secret project')
      await h.ui.getByTestId('tab-name-input').press('Enter')
      await clickInTab(h.app, '#conv')
      await expect.poll(() => existsSync(join(dir, 'tabs.json')) && readSavedTabs(dir).tabs[0].customTitle).toBe('Secret project')

      await h.app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
      })
      await h.ui.getByTestId('settings-button').click()
      await h.ui.getByTestId('clear-session').click()
      await expect(h.ui.getByText('ChatGPT session cleared')).toBeVisible()
      await expect(h.ui.getByTestId('tab').first()).toHaveAttribute('data-renamed', 'false')

      await expect
        .poll(() => (existsSync(join(dir, 'tabs.json')) ? JSON.stringify(readSavedTabs(dir)) : ''), { timeout: 5000 })
        .not.toMatch(/Secret project|conversation-2/)
      await h.cleanup()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

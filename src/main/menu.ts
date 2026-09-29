import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { AppController } from './AppController'

const isMac = process.platform === 'darwin'

/**
 * Application menu. Its accelerators are the app's keyboard shortcuts, so they work regardless of
 * whether the tab bar or a ChatGPT page has focus (CmdOrCtrl = Cmd on macOS, Ctrl elsewhere).
 */
export function buildApplicationMenu(controller: AppController): Menu {
  const openSettings = (): void => {
    controller.focusOrCreateWindow()
    controller.setSettingsOpen(true)
  }

  const tabNumberItems: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, index) => {
    const digit = index + 1
    return {
      label: digit === 9 ? 'Select Last Tab' : `Select Tab ${digit}`,
      accelerator: `CmdOrCtrl+${digit}`,
      click: () => controller.selectTabByNumber(digit)
    }
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => controller.newTab() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => controller.closeTab() },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close', label: 'Close Window', accelerator: 'Cmd+Shift+W' } satisfies MenuItemConstructorOptions]
          : [
              { label: 'Settings', accelerator: 'Ctrl+,', click: openSettings } satisfies MenuItemConstructorOptions,
              { type: 'separator' } satisfies MenuItemConstructorOptions,
              { role: 'quit' } satisfies MenuItemConstructorOptions
            ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Tab', accelerator: 'CmdOrCtrl+R', click: () => controller.reloadActiveTab() },
        { label: 'Force Reload Tab', accelerator: 'CmdOrCtrl+Shift+R', click: () => controller.reloadActiveTab(true) },
        { type: 'separator' },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => controller.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => controller.goForward() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Developer Tools for Tab',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => controller.toggleActiveTabDevTools()
        }
      ]
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => controller.selectAdjacentTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => controller.selectAdjacentTab(-1) },
        { type: 'separator' },
        { label: 'Rename Tab…', accelerator: 'CmdOrCtrl+Shift+E', click: () => controller.beginRename() },
        { label: 'Toggle Split View', accelerator: 'CmdOrCtrl+\\', click: () => controller.toggleSplit() },
        { type: 'separator' },
        ...tabNumberItems
      ]
    },
    {
      role: 'windowMenu'
    }
  ]

  return Menu.buildFromTemplate(template)
}

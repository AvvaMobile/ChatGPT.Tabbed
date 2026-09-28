import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { TOP_BAR_HEIGHT } from '@shared/constants'
import { createLogger } from '../logger'
import { currentPalette } from './theme'

const log = createLogger('window')

const isMac = process.platform === 'darwin'

function platformChrome(): BrowserWindowConstructorOptions {
  if (isMac) {
    // Native traffic lights inset into our custom tab bar; the renderer reserves space for them.
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
  }
  const colors = currentPalette()
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.barSymbol, height: TOP_BAR_HEIGHT }
  }
}

export function updateWindowTheme(win: BrowserWindow): void {
  const colors = currentPalette()
  win.setBackgroundColor(colors.bar)
  if (!isMac && typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.barSymbol, height: TOP_BAR_HEIGHT })
  }
}

/** Creates the app shell window that hosts the tab bar UI (local, trusted renderer). */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'ChatGPT Tabs',
    backgroundColor: currentPalette().bar,
    ...platformChrome(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false
    }
  })

  // The shell UI never navigates or opens windows; this also stops files dropped on the tab bar
  // from replacing the UI.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('render-process-gone', (_event, details) => {
    log.error(`shell UI renderer gone (${details.reason}); reloading`)
    if (!win.isDestroyed()) win.webContents.reload()
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    win.loadURL(devServer).catch((error: unknown) => log.error('failed to load dev UI', error))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch((error: unknown) => log.error('failed to load UI', error))
  }
  return win
}

/** True if the URL belongs to the app's own shell UI (dev server or packaged file). */
export function isShellUrl(url: string): boolean {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer && url.startsWith(devServer)) return true
  return url.startsWith('file://') && url.includes('/renderer/index.html')
}

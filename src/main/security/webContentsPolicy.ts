import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { createLogger } from '../logger'
import { attachContextMenu } from '../tabs/contextMenu'
import { openExternalSafely } from './externalLinks'
import {
  decideNavigation,
  decideWindowOpen,
  redactUrl,
  type NavigationContext
} from './navigationPolicy'

const log = createLogger('policy')

export interface NavigationPolicyOptions {
  context: NavigationContext
  /** Called when a ChatGPT page asks to open another ChatGPT page in a new window (tab context only). */
  openInNewTab?: (url: string) => void
}

/** Hardened options for OAuth/login popups. They inherit the opener's (persistent) session. */
export function popupWindowOptions(parent: BrowserWindow | null): BrowserWindowConstructorOptions {
  return {
    width: 520,
    height: 720,
    parent: parent ?? undefined,
    modal: false,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true
    }
  }
}

function isFreshPopup(webContents: WebContents): boolean {
  const url = webContents.getURL()
  return !url || url === 'about:blank'
}

/**
 * Wires navigation, redirect and window-open handling for a remote (ChatGPT/auth) web contents.
 * Applied to tabs, the login window and every popup they spawn.
 */
export function applyNavigationPolicy(webContents: WebContents, options: NavigationPolicyOptions): void {
  const { context } = options

  const guard = (event: Electron.Event, targetUrl: string, kind: string): void => {
    const decision = decideNavigation({ targetUrl, currentUrl: webContents.getURL(), context })
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') {
      openExternalSafely(targetUrl)
      // A popup that only existed to show an external page has nothing left to do.
      if (context !== 'tab' && isFreshPopup(webContents)) {
        BrowserWindow.fromWebContents(webContents)?.close()
      }
    } else {
      log.warn(`blocked ${kind} to ${redactUrl(targetUrl) || 'unsupported url'}`)
    }
  }

  webContents.on('will-navigate', (event) => guard(event, event.url, 'navigation'))
  webContents.on('will-redirect', (event) => {
    if (event.isMainFrame) guard(event, event.url, 'redirect')
  })

  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen({ url, context })
    switch (decision) {
      case 'new-tab':
        options.openInNewTab?.(url)
        return { action: 'deny' }
      case 'popup':
        return {
          action: 'allow',
          overrideBrowserWindowOptions: popupWindowOptions(BrowserWindow.fromWebContents(webContents))
        }
      case 'external':
        openExternalSafely(url)
        return { action: 'deny' }
      default:
        log.warn(`blocked window.open to ${redactUrl(url) || 'unsupported url'}`)
        return { action: 'deny' }
    }
  })

  webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false)
    applyNavigationPolicy(child.webContents, { context: context === 'login' ? 'login' : 'popup' })
    attachContextMenu(child.webContents)
    log.debug('auth/popup window opened')
  })
}

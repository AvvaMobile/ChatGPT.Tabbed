import { EventEmitter } from 'node:events'
import { BrowserWindow } from 'electron'
import { CHATGPT_LOGIN_URL, CHATGPT_PARTITION } from '@shared/constants'
import { createLogger } from '../logger'
import { isAuthUrl, parseUrl } from '../security/navigationPolicy'
import { applyNavigationPolicy } from '../security/webContentsPolicy'
import { attachContextMenu } from '../tabs/contextMenu'
import { isSignInLandingUrl, type ChatGptSession } from '../session/chatgptSession'

const log = createLogger('login')

interface LoginWindowEvents {
  /** Session cookies appeared after the user went through the sign-in pages. */
  'signed-in': []
  /** Window is gone (for any reason). */
  closed: []
}

/**
 * Dedicated sign-in window. It uses the same persistent partition as the tabs, so the cookies
 * set by ChatGPT/OpenAI during a manual login are immediately visible to every tab.
 * The app never reads or stores credentials: the user types them into the real web pages.
 */
export class LoginWindow extends EventEmitter<LoginWindowEvents> {
  private window: BrowserWindow | null = null
  private sawAuthPage = false
  private completing = false

  constructor(
    private readonly chatgpt: ChatGptSession,
    private readonly backgroundColor: () => string
  ) {
    super()
  }

  get isOpen(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  open(parent: BrowserWindow | null): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }

    this.sawAuthPage = false
    this.completing = false
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 400,
      minHeight: 500,
      title: 'Sign in to ChatGPT',
      parent: parent ?? undefined,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: this.backgroundColor(),
      webPreferences: {
        partition: CHATGPT_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        safeDialogs: true
      }
    })
    this.window = win

    const contents = win.webContents
    applyNavigationPolicy(contents, { context: 'login' })
    attachContextMenu(contents)

    // Keep our own window title instead of whatever the web page sets.
    win.on('page-title-updated', (event) => event.preventDefault())
    win.once('ready-to-show', () => win.show())

    const onNavigated = (url: string): void => {
      const parsed = parseUrl(url)
      if (!parsed) return
      if (isAuthUrl(parsed) || parsed.pathname.startsWith('/auth') || parsed.pathname.startsWith('/api/auth')) {
        this.sawAuthPage = true
        return
      }
      if (this.sawAuthPage && isSignInLandingUrl(url)) void this.checkCompletion()
    }
    contents.on('did-navigate', (_event, url) => onNavigated(url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) onNavigated(url)
    })

    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) log.warn(`login page failed to load (${code} ${description})`)
    })

    win.on('closed', () => {
      this.window = null
      log.info('login window closed')
      this.emit('closed')
    })

    log.info('opening login window')
    contents.loadURL(CHATGPT_LOGIN_URL).catch(() => undefined)
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close()
  }

  private async checkCompletion(): Promise<void> {
    if (this.completing) return
    if (!(await this.chatgpt.isSignedIn())) return
    this.completing = true
    log.info('sign-in detected')
    this.emit('signed-in')
    // Give the page a moment to finish its post-login redirect before closing.
    setTimeout(() => this.close(), 800)
  }
}

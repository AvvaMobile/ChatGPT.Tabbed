import { app, dialog, nativeTheme, type BrowserWindow } from 'electron'
import { IpcChannel, type AppInfo, type AppState, type ClearSessionResult } from '@shared/ipc'
import { LoginWindow } from './auth/LoginWindow'
import { createLogger } from './logger'
import type { ChatGptSession } from './session/chatgptSession'
import { TabManager } from './tabs/TabManager'
import { createMainWindow, updateWindowTheme } from './window/mainWindow'
import { currentPalette } from './window/theme'

const log = createLogger('app')

/**
 * Glue between the shell window, the tab manager, the login window and the renderer UI.
 * Holds the small amount of UI state that lives in the main process (settings open, fullscreen).
 */
export class AppController {
  private window: BrowserWindow | null = null
  private tabs: TabManager | null = null
  private settingsOpen = false
  private stateUpdateScheduled = false
  private readonly login: LoginWindow
  private reloadAfterLogin = false

  constructor(private readonly chatgpt: ChatGptSession) {
    this.login = new LoginWindow(chatgpt, () => currentPalette().content)
    this.login.on('signed-in', () => this.handleSignedIn())
    this.login.on('closed', () => {
      void this.handleLoginClosed()
    })
    nativeTheme.on('updated', () => this.applyTheme())
  }

  get mainWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  get tabManager(): TabManager | null {
    return this.tabs
  }

  /** Creates the shell window with one fresh ChatGPT tab (app start, macOS dock re-open). */
  createWindow(): BrowserWindow {
    const win = createMainWindow()
    const tabs = new TabManager(win, () => currentPalette().content)
    this.window = win
    this.tabs = tabs
    this.settingsOpen = false

    tabs.on('changed', () => this.scheduleStateUpdate())

    const relayout = (): void => tabs.updateLayout()
    win.on('resize', relayout)
    win.on('maximize', relayout)
    win.on('unmaximize', relayout)
    win.on('restore', relayout)
    const onFullscreen = (): void => {
      relayout()
      this.scheduleStateUpdate()
    }
    win.on('enter-full-screen', onFullscreen)
    win.on('leave-full-screen', onFullscreen)

    win.webContents.on('did-finish-load', () => this.sendState())
    win.once('ready-to-show', () => win.show())

    win.on('closed', () => {
      tabs.destroyAllTabs()
      if (this.tabs === tabs) this.tabs = null
      if (this.window === win) this.window = null
      this.login.close()
      log.info('main window closed, tabs destroyed')
    })

    tabs.createTab()
    return win
  }

  focusOrCreateWindow(): void {
    const win = this.mainWindow
    if (!win) {
      this.createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  getState(): AppState {
    const tabs = this.tabs?.listTabs() ?? []
    return {
      tabs,
      activeTabId: this.tabs?.getActiveId() ?? null,
      settingsOpen: this.settingsOpen,
      fullscreen: this.mainWindow?.isFullScreen() ?? false,
      loginWindowOpen: this.login.isOpen
    }
  }

  getInfo(): AppInfo {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      partition: this.chatgpt.partition
    }
  }

  // ---- tab commands -------------------------------------------------------

  newTab(): void {
    this.setSettingsOpen(false)
    this.tabs?.createTab()
  }

  activateTab(id: string): void {
    this.setSettingsOpen(false)
    this.tabs?.activateTab(id)
  }

  closeTab(id?: string): void {
    const target = id ?? this.tabs?.getActiveId()
    if (target) this.tabs?.closeTab(target)
  }

  reloadActiveTab(ignoreCache = false): void {
    this.tabs?.reloadTab(undefined, ignoreCache)
  }

  reloadTab(id: string): void {
    this.tabs?.reloadTab(id)
  }

  goBack(): void {
    this.tabs?.goBack()
  }

  goForward(): void {
    this.tabs?.goForward()
  }

  selectTabByNumber(digit: number): void {
    this.setSettingsOpen(false)
    this.tabs?.activateByShortcut(digit)
  }

  selectAdjacentTab(delta: 1 | -1): void {
    this.setSettingsOpen(false)
    this.tabs?.activateAdjacent(delta)
  }

  toggleActiveTabDevTools(): void {
    this.tabs?.getActiveTab()?.view.webContents.toggleDevTools()
  }

  // ---- settings / auth ----------------------------------------------------

  setSettingsOpen(open: boolean): void {
    if (this.settingsOpen === open) return
    this.settingsOpen = open
    this.tabs?.setContentHidden(open)
    if (open) this.mainWindow?.webContents.focus()
    this.scheduleStateUpdate()
  }

  openLogin(): void {
    this.reloadAfterLogin = true
    this.login.open(this.mainWindow)
    this.scheduleStateUpdate()
  }

  isSignedIn(): Promise<boolean> {
    return this.chatgpt.isSignedIn()
  }

  async clearSession(): Promise<ClearSessionResult> {
    const win = this.mainWindow
    const options = {
      type: 'warning' as const,
      buttons: ['Clear Session', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Clear ChatGPT Session',
      message: 'Sign out and clear ChatGPT data?',
      detail:
        'This removes ChatGPT cookies, cache and site storage from this app and signs you out in every tab. Your conversations stay in your ChatGPT account.'
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return { cleared: false }

    this.reloadAfterLogin = false
    this.login.close()
    await this.chatgpt.clear()
    this.tabs?.resetAllToHome()
    this.scheduleStateUpdate()
    return { cleared: true }
  }

  /** Releases every web contents; used when the app quits. */
  dispose(): void {
    this.login.close()
    this.tabs?.destroyAllTabs()
    this.tabs = null
  }

  private handleSignedIn(): void {
    if (!this.reloadAfterLogin) return
    this.reloadAfterLogin = false
    this.tabs?.reloadAll()
    this.setSettingsOpen(false)
    this.scheduleStateUpdate()
  }

  private async handleLoginClosed(): Promise<void> {
    // The user may have signed in without us detecting it (e.g. provider-specific landing page);
    // refreshing the tabs makes them pick up whatever session now exists.
    if (this.reloadAfterLogin) {
      this.reloadAfterLogin = false
      this.tabs?.reloadAll()
    }
    this.scheduleStateUpdate()
  }

  private applyTheme(): void {
    const win = this.mainWindow
    if (win) updateWindowTheme(win)
    this.tabs?.setBackgroundColor(currentPalette().content)
  }

  private scheduleStateUpdate(): void {
    if (this.stateUpdateScheduled) return
    this.stateUpdateScheduled = true
    setImmediate(() => {
      this.stateUpdateScheduled = false
      this.sendState()
    })
  }

  private sendState(): void {
    const win = this.mainWindow
    if (!win || win.webContents.isDestroyed()) return
    win.webContents.send(IpcChannel.StateChanged, this.getState())
  }
}

import { app, dialog, Menu, nativeTheme, type BrowserWindow } from 'electron'
import {
  IpcChannel,
  type AppInfo,
  type AppSettings,
  type AppState,
  type ClearSessionResult
} from '@shared/ipc'
import { LoginWindow } from './auth/LoginWindow'
import { createLogger } from './logger'
import type { SettingsStore } from './persistence/SettingsStore'
import { buildTabSession } from './persistence/tabSession'
import type { TabSessionStore } from './persistence/TabSessionStore'
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

  constructor(
    private readonly chatgpt: ChatGptSession,
    private readonly settings: SettingsStore,
    private readonly tabSession: TabSessionStore
  ) {
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

  /**
   * Creates the shell window (app start, macOS dock re-open) and either restores the previous
   * tabs or opens one fresh ChatGPT tab.
   */
  createWindow(): BrowserWindow {
    const win = createMainWindow()
    const tabs = new TabManager(win, () => currentPalette().content)
    this.window = win
    this.tabs = tabs
    this.settingsOpen = false

    tabs.on('changed', () => {
      this.scheduleStateUpdate()
      if (this.settings.get().restoreTabs) this.tabSession.schedule(() => this.currentTabSession(tabs))
    })

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

    // Save the final layout before the tabs are torn down (window close and app quit).
    win.on('close', () => {
      if (this.settings.get().restoreTabs) this.tabSession.saveNow(this.currentTabSession(tabs))
    })

    win.on('closed', () => {
      tabs.destroyAllTabs()
      if (this.tabs === tabs) this.tabs = null
      if (this.window === win) this.window = null
      this.login.close()
      log.info('main window closed, tabs destroyed')
    })

    this.openInitialTabs(tabs)
    return win
  }

  private openInitialTabs(tabs: TabManager): void {
    const saved = this.settings.get().restoreTabs ? this.tabSession.load() : null
    if (!saved) {
      tabs.createTab()
      return
    }
    log.info(`restoring ${saved.tabs.length} tab(s)${saved.split ? ' in split view' : ''}`)
    // Every tab starts deferred; only the tabs that are on screen get loaded below.
    if (saved.split) tabs.enableSplitEmpty()
    const ids = saved.tabs.map(
      (tab) =>
        tabs.createTab({
          url: tab.url,
          title: tab.title,
          customTitle: tab.customTitle,
          group: saved.split ? tab.group : 0,
          activate: false,
          lazy: true
        })?.id ?? null
    )
    const other = saved.split ? (saved.activeIndex === saved.split.left ? saved.split.right : saved.split.left) : null
    for (const index of [other, saved.activeIndex]) {
      const id = index === null ? null : ids[index]
      if (id) tabs.activateTab(id)
    }
  }

  private currentTabSession(tabs: TabManager) {
    const { tabs: saved, activeIndex, split } = tabs.snapshot()
    return buildTabSession(saved, activeIndex, split)
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
      split: this.tabs?.isSplit ?? false,
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

  newTab(group?: 0 | 1): void {
    this.setSettingsOpen(false)
    this.tabs?.createTab({ group })
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

  toggleSplit(): void {
    this.setSettingsOpen(false)
    this.tabs?.toggleSplit()
  }

  moveToOtherSide(id: string): void {
    this.setSettingsOpen(false)
    this.tabs?.moveToOtherSide(id)
  }

  moveTab(id: string, group: 0 | 1, index: number): void {
    this.tabs?.moveTab(id, group, index)
  }

  renameTab(id: string, name: string | null): void {
    this.tabs?.renameTab(id, name)
  }

  /** Asks the tab bar to show the inline name editor for a tab (default: the active tab). */
  beginRename(id?: string): void {
    const target = id ?? this.tabs?.getActiveId()
    const win = this.mainWindow
    if (!target || !win) return
    this.setSettingsOpen(false)
    win.webContents.focus()
    win.webContents.send(IpcChannel.BeginRename, target)
  }

  duplicateTab(id: string): void {
    const tab = this.tabs?.getTab(id)
    if (!tab) return
    const snapshot = tab.pendingUrl ?? tab.url
    this.tabs?.createTab({ url: snapshot, group: this.tabs.groupOf(id) ?? undefined })
  }

  closeOtherTabs(id: string): void {
    const tabs = this.tabs
    if (!tabs?.getTab(id)) return
    const group = tabs.groupOf(id)
    for (const info of tabs.listTabs()) {
      if (info.id !== id && info.group === group) tabs.closeTab(info.id)
    }
    tabs.activateTab(id)
  }

  /** Native right-click menu for a tab in the tab bar. */
  showTabMenu(id: string): void {
    const win = this.mainWindow
    const tab = this.tabs?.getTab(id)
    if (!win || !tab) return
    const total = this.tabs?.size ?? 0
    Menu.buildFromTemplate([
      { label: 'Rename Tab…', click: () => this.beginRename(id) },
      { label: 'Reset Tab Name', enabled: tab.customTitle !== null, click: () => this.renameTab(id, null) },
      { type: 'separator' },
      { label: 'Reload Tab', click: () => this.reloadTab(id) },
      { label: 'Duplicate Tab', click: () => this.duplicateTab(id) },
      {
        label: this.tabs?.isSplit ? 'Move to Other Side' : 'Open in Split View',
        enabled: this.tabs?.isSplit || total > 1,
        click: () => this.moveToOtherSide(id)
      },
      { type: 'separator' },
      { label: 'Close Tab', click: () => this.closeTab(id) },
      { label: 'Close Other Tabs', enabled: total > 1, click: () => this.closeOtherTabs(id) }
    ]).popup({ window: win })
  }

  getSettings(): AppSettings {
    return this.settings.get()
  }

  updateSettings(patch: unknown): AppSettings {
    const next = this.settings.update(patch)
    if (next.restoreTabs && this.tabs) this.tabSession.saveNow(this.currentTabSession(this.tabs))
    // Turning restore off also forgets the saved tabs.
    if (!next.restoreTabs) this.tabSession.clear()
    return next
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
    // Saved tabs contain conversation links and names; forget them together with the session.
    this.tabSession.clear()
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

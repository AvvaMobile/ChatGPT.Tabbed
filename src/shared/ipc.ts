/** IPC channel names shared by main, preload and renderer. */
export const IpcChannel = {
  GetState: 'app:get-state',
  StateChanged: 'app:state-changed',
  GetInfo: 'app:get-info',
  CreateTab: 'tabs:create',
  ActivateTab: 'tabs:activate',
  CloseTab: 'tabs:close',
  ReloadTab: 'tabs:reload',
  GoBack: 'tabs:go-back',
  GoForward: 'tabs:go-forward',
  OpenSettings: 'settings:open',
  CloseSettings: 'settings:close',
  OpenLogin: 'auth:open-login',
  GetAuthStatus: 'auth:get-status',
  ClearSession: 'session:clear',
  RenameTab: 'tabs:rename',
  ShowTabMenu: 'tabs:show-menu',
  BeginRename: 'tabs:begin-rename',
  ToggleSplit: 'tabs:toggle-split',
  GetSettings: 'settings:get',
  SetSettings: 'settings:set'
} as const

export type TabStatus = 'loading' | 'ready' | 'error' | 'crashed'

export interface TabError {
  code: number
  description: string
}

export interface TabInfo {
  id: string
  title: string
  /** Origin + path only; query strings/fragments are stripped before leaving the main process. */
  url: string
  /** Active tab of the focused column. */
  active: boolean
  /** Shown in its column (the column's active tab). */
  selected: boolean
  /** Column the tab belongs to: 0 = left (or the only one), 1 = right. */
  group: 0 | 1
  /** True when the user gave the tab a custom name. */
  renamed: boolean
  /** Which split-view pane shows this tab, or null when it is not on screen in split view. */
  pane: 'left' | 'right' | null
  status: TabStatus
  error: TabError | null
  canGoBack: boolean
  canGoForward: boolean
}

export interface AppState {
  tabs: TabInfo[]
  activeTabId: string | null
  settingsOpen: boolean
  /** Two tabs side by side. */
  split: boolean
  fullscreen: boolean
  loginWindowOpen: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  partition: string
}

export interface AuthStatus {
  signedIn: boolean
}

export interface AppSettings {
  /** Reopen the previous tabs (with their names) when the app starts. */
  restoreTabs: boolean
}

export interface ClearSessionResult {
  cleared: boolean
}

/** API exposed by the preload script on `window.chatgptTabs`. */
export interface RendererApi {
  platform: string
  getState(): Promise<AppState>
  getInfo(): Promise<AppInfo>
  onStateChanged(listener: (state: AppState) => void): () => void
  /** Opens a new chat in the given column (defaults to the focused one). */
  createTab(group?: 0 | 1): Promise<void>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  reloadTab(id?: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  openSettings(): Promise<void>
  closeSettings(): Promise<void>
  openLogin(): Promise<void>
  getAuthStatus(): Promise<AuthStatus>
  clearSession(): Promise<ClearSessionResult>
  /** Sets a custom tab name; an empty string or null restores the page title. */
  renameTab(id: string, name: string | null): Promise<void>
  showTabMenu(id: string): Promise<void>
  toggleSplit(): Promise<void>
  onBeginRename(listener: (id: string) => void): () => void
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}

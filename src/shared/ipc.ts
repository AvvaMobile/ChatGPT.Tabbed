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
  ClearSession: 'session:clear'
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
  active: boolean
  status: TabStatus
  error: TabError | null
  canGoBack: boolean
  canGoForward: boolean
}

export interface AppState {
  tabs: TabInfo[]
  activeTabId: string | null
  settingsOpen: boolean
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

export interface ClearSessionResult {
  cleared: boolean
}

/** API exposed by the preload script on `window.chatgptTabs`. */
export interface RendererApi {
  platform: string
  getState(): Promise<AppState>
  getInfo(): Promise<AppInfo>
  onStateChanged(listener: (state: AppState) => void): () => void
  createTab(): Promise<void>
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
}

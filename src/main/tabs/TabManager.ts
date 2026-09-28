import { EventEmitter } from 'node:events'
import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { CHATGPT_HOME_URL, CHATGPT_PARTITION, DEFAULT_TAB_TITLE, MAX_TABS } from '@shared/constants'
import type { TabError, TabInfo, TabStatus } from '@shared/ipc'
import { createLogger } from '../logger'
import { isChatGptUrl, redactUrl } from '../security/navigationPolicy'
import { applyNavigationPolicy } from '../security/webContentsPolicy'
import { computeTabViewBounds } from '../window/layout'
import { attachContextMenu } from './contextMenu'
import { adjacentTabId, pickNextActiveTab, tabIdForShortcut } from './tabOrder'

const log = createLogger('tabs')

/** Chromium net error for navigations that were superseded/aborted; not a real failure. */
const ERR_ABORTED = -3

export interface Tab {
  id: string
  view: WebContentsView
  title: string
  url: string
  status: TabStatus
  error: TabError | null
  /** Last URL that should be retried after a failed load. */
  retryUrl: string
}

export interface CreateTabOptions {
  url?: string
  activate?: boolean
}

interface TabManagerEvents {
  changed: []
}

/**
 * Owns every ChatGPT tab. Each tab has its own WebContentsView (own renderer, own navigation
 * history) while all of them share the single persistent `persist:chatgpt` session.
 *
 * Only the active tab's view is attached to the window; inactive views stay alive (detached)
 * so their conversations continue where they left off.
 */
export class TabManager extends EventEmitter<TabManagerEvents> {
  private readonly tabs = new Map<string, Tab>()
  private order: string[] = []
  private activeId: string | null = null
  private attachedId: string | null = null
  private nextId = 1
  private contentHidden = false
  private destroyed = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly backgroundColor: () => string
  ) {
    super()
  }

  createTab(options: CreateTabOptions = {}): Tab | null {
    if (this.destroyed || this.window.isDestroyed()) return null
    if (this.tabs.size >= MAX_TABS) {
      log.warn(`tab limit (${MAX_TABS}) reached`)
      return null
    }

    const url = options.url && isChatGptUrl(options.url) ? options.url : CHATGPT_HOME_URL
    const id = `tab-${this.nextId++}`
    const view = new WebContentsView({
      webPreferences: {
        partition: CHATGPT_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        safeDialogs: true,
        spellcheck: true,
        backgroundThrottling: true
      }
    })
    view.setBackgroundColor(this.backgroundColor())

    const tab: Tab = {
      id,
      view,
      title: DEFAULT_TAB_TITLE,
      url,
      status: 'loading',
      error: null,
      retryUrl: url
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this.wireTab(tab)

    log.info(`created ${id}`)
    view.webContents.loadURL(url).catch(() => {
      // Failures are reported through did-fail-load; nothing else to do here.
    })

    if (options.activate !== false || this.activeId === null) {
      this.activateTab(id)
    } else {
      this.emitChanged()
    }
    return tab
  }

  activateTab(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab || this.destroyed) return false
    this.activeId = id
    this.syncAttachedView()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
    return true
  }

  /** Closes a tab and destroys its web contents. Closing the last tab opens a fresh one. */
  closeTab(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false

    const nextActive = this.activeId === id ? pickNextActiveTab(this.order, id) : this.activeId
    this.order = this.order.filter((tabId) => tabId !== id)
    this.tabs.delete(id)
    if (this.activeId === id) this.activeId = null

    this.disposeTab(tab)
    log.info(`closed ${id}`)

    if (this.destroyed) return true
    if (this.order.length === 0) {
      this.createTab()
    } else if (nextActive && nextActive !== this.activeId) {
      this.activateTab(nextActive)
    } else {
      this.syncAttachedView()
      this.emitChanged()
    }
    return true
  }

  reloadTab(id: string | null = this.activeId, ignoreCache = false): boolean {
    const tab = id ? this.tabs.get(id) : undefined
    if (!tab) return false
    const contents = tab.view.webContents
    const needsFreshLoad = tab.status === 'error' || tab.status === 'crashed' || !contents.getURL()
    tab.status = 'loading'
    tab.error = null
    if (needsFreshLoad) {
      contents.loadURL(tab.retryUrl || CHATGPT_HOME_URL).catch(() => undefined)
    } else if (ignoreCache) {
      contents.reloadIgnoringCache()
    } else {
      contents.reload()
    }
    this.syncAttachedView()
    this.emitChanged()
    return true
  }

  reloadAll(): void {
    for (const id of this.order) this.reloadTab(id)
  }

  /** Sends every tab back to the ChatGPT start page (used after logout/login changes). */
  resetAllToHome(): void {
    for (const tab of this.tabs.values()) {
      tab.status = 'loading'
      tab.error = null
      tab.retryUrl = CHATGPT_HOME_URL
      tab.view.webContents.loadURL(CHATGPT_HOME_URL).catch(() => undefined)
    }
    this.syncAttachedView()
    this.emitChanged()
  }

  goBack(): void {
    const history = this.getActiveTab()?.view.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  goForward(): void {
    const history = this.getActiveTab()?.view.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  activateByShortcut(digit: number): void {
    const id = tabIdForShortcut(this.order, digit)
    if (id) this.activateTab(id)
  }

  activateAdjacent(delta: 1 | -1): void {
    const id = adjacentTabId(this.order, this.activeId, delta)
    if (id) this.activateTab(id)
  }

  getActiveTab(): Tab | null {
    return this.activeId ? (this.tabs.get(this.activeId) ?? null) : null
  }

  getActiveId(): string | null {
    return this.activeId
  }

  getTab(id: string): Tab | null {
    return this.tabs.get(id) ?? null
  }

  get size(): number {
    return this.tabs.size
  }

  listTabs(): TabInfo[] {
    return this.order.flatMap((id) => {
      const tab = this.tabs.get(id)
      if (!tab) return []
      const contents = tab.view.webContents
      const alive = !contents.isDestroyed()
      return [
        {
          id,
          title: tab.title,
          url: redactUrl(tab.url),
          active: id === this.activeId,
          status: tab.status,
          error: tab.error,
          canGoBack: alive && contents.navigationHistory.canGoBack(),
          canGoForward: alive && contents.navigationHistory.canGoForward()
        }
      ]
    })
  }

  updateTabTitle(id: string, title: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const clean = title.replace(/\s+/g, ' ').trim()
    const next = clean || DEFAULT_TAB_TITLE
    if (tab.title === next) return
    tab.title = next
    this.emitChanged()
  }

  /** Hide/show the web content area (e.g. while the Settings screen covers it). */
  setContentHidden(hidden: boolean): void {
    if (this.contentHidden === hidden) return
    this.contentHidden = hidden
    this.syncAttachedView()
    if (!hidden) this.focusActive()
  }

  /** Recomputes the active view bounds from the current window content size. */
  updateLayout(): void {
    if (this.window.isDestroyed() || !this.attachedId) return
    const tab = this.tabs.get(this.attachedId)
    if (!tab) return
    const [width, height] = this.window.getContentSize()
    tab.view.setBounds(computeTabViewBounds({ width, height }))
  }

  setBackgroundColor(color: string): void {
    for (const tab of this.tabs.values()) tab.view.setBackgroundColor(color)
  }

  /** Destroys every tab. Used on window close and app shutdown; no replacement tab is created. */
  destroyAllTabs(): void {
    this.destroyed = true
    for (const tab of this.tabs.values()) this.disposeTab(tab)
    this.tabs.clear()
    this.order = []
    this.activeId = null
    this.attachedId = null
    this.removeAllListeners()
  }

  /** Test/diagnostic helper: web contents ids of all live tabs. */
  webContentsIds(): number[] {
    return this.order.flatMap((id) => {
      const contents = this.tabs.get(id)?.view.webContents
      return contents && !contents.isDestroyed() ? [contents.id] : []
    })
  }

  private wireTab(tab: Tab): void {
    const contents = tab.view.webContents

    applyNavigationPolicy(contents, {
      context: 'tab',
      openInNewTab: (url) => this.createTab({ url })
    })
    attachContextMenu(contents)

    contents.on('page-title-updated', (_event, title) => this.updateTabTitle(tab.id, title))

    contents.on('did-start-loading', () => {
      if (tab.status === 'crashed') return
      this.setStatus(tab, 'loading')
    })

    contents.on('did-stop-loading', () => {
      if (tab.status === 'loading') this.setStatus(tab, 'ready')
      else this.emitChanged()
    })

    const trackUrl = (url: string): void => {
      if (!this.tabs.has(tab.id)) return
      tab.url = url
      if (isChatGptUrl(url)) tab.retryUrl = url
      this.emitChanged()
    }
    contents.on('did-navigate', (_event, url) => trackUrl(url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) trackUrl(url)
    })

    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return
      log.warn(`${tab.id} failed to load ${redactUrl(validatedUrl)} (${errorCode} ${errorDescription})`)
      if (validatedUrl && isChatGptUrl(validatedUrl)) tab.retryUrl = validatedUrl
      tab.error = { code: errorCode, description: errorDescription || 'Unknown network error' }
      this.setStatus(tab, 'error')
    })

    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      log.error(`${tab.id} renderer gone (${details.reason})`)
      tab.error = { code: details.exitCode, description: `The page stopped unexpectedly (${details.reason}).` }
      this.setStatus(tab, 'crashed')
    })

    contents.on('unresponsive', () => log.warn(`${tab.id} became unresponsive`))
    contents.on('responsive', () => log.info(`${tab.id} is responsive again`))
  }

  private setStatus(tab: Tab, status: TabStatus): void {
    if (!this.tabs.has(tab.id)) return
    if (status === 'loading') tab.error = null
    tab.status = status
    if (tab.id === this.activeId) this.syncAttachedView()
    this.emitChanged()
  }

  /** Ensures exactly the visible active tab's view is attached to the window. */
  private syncAttachedView(): void {
    if (this.window.isDestroyed()) return
    const active = this.getActiveTab()
    const showable =
      active && !this.contentHidden && active.status !== 'error' && active.status !== 'crashed' ? active : null
    const desiredId = showable?.id ?? null

    if (this.attachedId && this.attachedId !== desiredId) {
      const previous = this.tabs.get(this.attachedId)
      if (previous && !previous.view.webContents.isDestroyed()) {
        this.window.contentView.removeChildView(previous.view)
      }
      this.attachedId = null
    }

    if (showable && this.attachedId !== desiredId) {
      this.window.contentView.addChildView(showable.view)
      this.attachedId = desiredId
    }
    this.updateLayout()
  }

  private focusActive(): void {
    const active = this.getActiveTab()
    if (active && active.id === this.attachedId && !active.view.webContents.isDestroyed()) {
      active.view.webContents.focus()
    }
  }

  private disposeTab(tab: Tab): void {
    if (this.attachedId === tab.id) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
      this.attachedId = null
    }
    const contents: WebContents = tab.view.webContents
    if (!contents.isDestroyed()) {
      // WebContentsView does not destroy its web contents on garbage collection; close explicitly.
      contents.close({ waitForBeforeUnload: false })
    }
  }

  private emitChanged(): void {
    if (!this.destroyed) this.emit('changed')
  }
}

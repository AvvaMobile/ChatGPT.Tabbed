import { EventEmitter } from 'node:events'
import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { CHATGPT_HOME_URL, CHATGPT_PARTITION, DEFAULT_TAB_TITLE, MAX_TAB_NAME_LENGTH, MAX_TABS } from '@shared/constants'
import type { TabError, TabInfo, TabStatus } from '@shared/ipc'
import { cleanTitle } from '@shared/validation'
import { restorableUrl, type SavedSplit, type SavedTab } from '../persistence/tabSession'
import { createLogger } from '../logger'
import { isChatGptUrl, redactUrl } from '../security/navigationPolicy'
import { applyNavigationPolicy } from '../security/webContentsPolicy'
import { computeSplitBounds, computeTabViewBounds } from '../window/layout'
import { attachContextMenu } from './contextMenu'
import { adjacentTabId, pickNextActiveTab, tabIdForShortcut } from './tabOrder'

const log = createLogger('tabs')

/** Chromium net error for navigations that were superseded/aborted; not a real failure. */
const ERR_ABORTED = -3

export interface Tab {
  id: string
  view: WebContentsView
  /** Title reported by the page. */
  pageTitle: string
  /** Name given by the user; shown instead of the page title when set. */
  customTitle: string | null
  url: string
  /** Restored tabs load lazily: the URL is only opened when the tab is first shown. */
  pendingUrl: string | null
  status: TabStatus
  error: TabError | null
  /** Last URL that should be retried after a failed load. */
  retryUrl: string
}

export interface CreateTabOptions {
  url?: string
  activate?: boolean
  /** Initial page title (e.g. from a restored session) until the page reports its own. */
  title?: string
  customTitle?: string | null
  /** Defer loading until the tab is activated. */
  lazy?: boolean
}

interface TabManagerEvents {
  changed: []
}

/**
 * Owns every ChatGPT tab. Each tab has its own WebContentsView (own renderer, own navigation
 * history) while all of them share the single persistent `persist:chatgpt` session.
 *
 * Only the visible tabs' views are attached to the window (one, or two in split view); the
 * other views stay alive (detached) so their conversations continue where they left off.
 *
 * In split view `panes` holds the left and right tab; `activeId` is the focused one of the two.
 */
export class TabManager extends EventEmitter<TabManagerEvents> {
  private readonly tabs = new Map<string, Tab>()
  private order: string[] = []
  private activeId: string | null = null
  private panes: [string, string] | null = null
  private readonly attachedIds = new Set<string>()
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

    // A deferred tab never becomes active on its own: when restoring, the saved active tab is
    // created explicitly with `activate: true`.
    const lazy = options.lazy === true && options.activate === false
    const activate = !lazy && (options.activate !== false || this.activeId === null)
    const tab: Tab = {
      id,
      view,
      pageTitle: options.title ? cleanTitle(options.title, 200) : '',
      customTitle: options.customTitle ? cleanTitle(options.customTitle, MAX_TAB_NAME_LENGTH) || null : null,
      url,
      pendingUrl: lazy ? url : null,
      status: lazy ? 'ready' : 'loading',
      error: null,
      retryUrl: url
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this.wireTab(tab)

    log.info(`created ${id}${lazy ? ' (deferred)' : ''}`)
    if (!lazy) this.load(tab, url)

    if (activate) {
      this.activateTab(id)
    } else {
      this.emitChanged()
    }
    return tab
  }

  activateTab(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab || this.destroyed) return false
    // In split view a tab that is not on screen replaces the focused pane.
    if (this.panes && !this.panes.includes(id)) {
      const focused = this.activeId ? this.panes.indexOf(this.activeId) : 0
      this.panes[focused === -1 ? 0 : focused] = id
    }
    this.activeId = id
    if (tab.pendingUrl) this.load(tab, tab.pendingUrl)
    this.syncAttachedView()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
    return true
  }

  /** Closes a tab and destroys its web contents. Closing the last tab opens a fresh one. */
  closeTab(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false

    let nextActive = this.activeId === id ? pickNextActiveTab(this.order, id) : this.activeId
    // Closing one of the two split tabs leaves the other one full width.
    if (this.panes?.includes(id)) {
      const other = this.panes[0] === id ? this.panes[1] : this.panes[0]
      if (this.activeId === id) nextActive = other
      this.panes = null
    }
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
      this.load(tab, tab.pendingUrl ?? (tab.retryUrl || CHATGPT_HOME_URL))
    } else if (ignoreCache) {
      contents.reloadIgnoringCache()
    } else {
      contents.reload()
    }
    this.syncAttachedView()
    this.emitChanged()
    return true
  }

  /** Reloads every loaded tab; deferred tabs pick up the new state when they are first shown. */
  reloadAll(): void {
    for (const [id, tab] of this.tabs) {
      if (!tab.pendingUrl) this.reloadTab(id)
    }
  }

  /** Sends every tab back to the ChatGPT start page (used after logout/login changes). */
  resetAllToHome(): void {
    for (const tab of this.tabs.values()) {
      tab.status = 'loading'
      tab.error = null
      tab.retryUrl = CHATGPT_HOME_URL
      tab.pageTitle = ''
      tab.customTitle = null
      this.load(tab, CHATGPT_HOME_URL)
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

  get isSplit(): boolean {
    return this.panes !== null
  }

  /**
   * Shows two tabs side by side: the active tab on the left and `partnerId` (or the neighbouring
   * tab, or a new chat) on the right. In split view, a partner replaces the unfocused pane.
   */
  enableSplit(partnerId?: string): void {
    const active = this.activeId
    if (!active || this.destroyed) return
    if (this.panes) {
      if (partnerId && this.tabs.has(partnerId) && !this.panes.includes(partnerId)) {
        const other = this.panes[0] === active ? 1 : 0
        this.panes[other] = partnerId
        this.loadIfPending(partnerId)
        this.syncAttachedView()
        this.emitChanged()
      }
      return
    }

    let partner = partnerId && partnerId !== active && this.tabs.has(partnerId) ? partnerId : null
    let focusPartner = false
    if (!partner) {
      const index = this.order.indexOf(active)
      partner = this.order[index + 1] ?? this.order[index - 1] ?? null
    }
    if (!partner) {
      partner = this.createTab({ activate: false })?.id ?? null
      focusPartner = true
    }
    if (!partner) return

    this.panes = [active, partner]
    this.loadIfPending(partner)
    if (focusPartner) this.activeId = partner
    this.syncAttachedView()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
  }

  disableSplit(): void {
    if (!this.panes) return
    this.panes = null
    this.syncAttachedView()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
  }

  toggleSplit(): void {
    if (this.panes) this.disableSplit()
    else this.enableSplit()
  }

  /** Restores a saved split: `left`/`right` are tab ids, the active tab must be one of them. */
  restoreSplit(left: string, right: string): void {
    if (!this.tabs.has(left) || !this.tabs.has(right) || left === right) return
    this.panes = [left, right]
    if (this.activeId !== left && this.activeId !== right) this.activeId = left
    this.loadIfPending(left)
    this.loadIfPending(right)
    this.syncAttachedView()
    this.emitChanged()
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
          title: this.displayTitle(tab),
          url: redactUrl(tab.url),
          active: id === this.activeId,
          renamed: tab.customTitle !== null,
          pane: this.panes ? (this.panes[0] === id ? 'left' : this.panes[1] === id ? 'right' : null) : null,
          status: tab.status,
          error: tab.error,
          canGoBack: alive && contents.navigationHistory.canGoBack(),
          canGoForward: alive && contents.navigationHistory.canGoForward()
        }
      ]
    })
  }

  /** Records the title reported by the page (shown unless the user renamed the tab). */
  updateTabTitle(id: string, title: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const next = cleanTitle(title, 200)
    if (tab.pageTitle === next) return
    tab.pageTitle = next
    this.emitChanged()
  }

  /** Gives a tab a custom name; null or blank restores the page title. */
  renameTab(id: string, name: string | null): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    const next = name ? cleanTitle(name, MAX_TAB_NAME_LENGTH) || null : null
    if (tab.customTitle === next) return true
    tab.customTitle = next
    this.emitChanged()
    return true
  }

  /** Tabs in order, reduced to what is needed to reopen them later. */
  snapshot(): { tabs: SavedTab[]; activeIndex: number; split: SavedSplit | null } {
    const tabs: SavedTab[] = []
    let activeIndex = 0
    for (const id of this.order) {
      const tab = this.tabs.get(id)
      if (!tab) continue
      if (id === this.activeId) activeIndex = tabs.length
      tabs.push({
        url: restorableUrl(tab.pendingUrl ?? tab.url) ?? CHATGPT_HOME_URL,
        title: tab.pageTitle,
        customTitle: tab.customTitle
      })
    }
    const split = this.panes ? { left: this.order.indexOf(this.panes[0]), right: this.order.indexOf(this.panes[1]) } : null
    return { tabs, activeIndex, split: split && split.left >= 0 && split.right >= 0 ? split : null }
  }

  /** Hide/show the web content area (e.g. while the Settings screen covers it). */
  setContentHidden(hidden: boolean): void {
    if (this.contentHidden === hidden) return
    this.contentHidden = hidden
    this.syncAttachedView()
    if (!hidden) this.focusActive()
  }

  /** Recomputes the visible views' bounds from the current window content size. */
  updateLayout(): void {
    if (this.window.isDestroyed() || this.attachedIds.size === 0) return
    const [width, height] = this.window.getContentSize()
    if (this.panes) {
      const { left, right } = computeSplitBounds({ width, height })
      this.tabs.get(this.panes[0])?.view.setBounds(left)
      this.tabs.get(this.panes[1])?.view.setBounds(right)
      return
    }
    for (const id of this.attachedIds) this.tabs.get(id)?.view.setBounds(computeTabViewBounds({ width, height }))
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
    this.panes = null
    this.attachedIds.clear()
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

    // Clicking into a split pane makes that tab the active one.
    contents.on('focus', () => {
      if (this.panes?.includes(tab.id) && this.activeId !== tab.id) {
        this.activeId = tab.id
        this.emitChanged()
      }
    })

    contents.on('unresponsive', () => log.warn(`${tab.id} became unresponsive`))
    contents.on('responsive', () => log.info(`${tab.id} is responsive again`))
  }

  private displayTitle(tab: Tab): string {
    return tab.customTitle ?? (tab.pageTitle || DEFAULT_TAB_TITLE)
  }

  private loadIfPending(id: string): void {
    const tab = this.tabs.get(id)
    if (tab?.pendingUrl) this.load(tab, tab.pendingUrl)
  }

  private load(tab: Tab, url: string): void {
    tab.pendingUrl = null
    tab.url = url
    tab.status = 'loading'
    tab.view.webContents.loadURL(url).catch(() => {
      // Failures are reported through did-fail-load; nothing else to do here.
    })
  }

  private setStatus(tab: Tab, status: TabStatus): void {
    if (!this.tabs.has(tab.id)) return
    if (status === 'loading') tab.error = null
    tab.status = status
    if (this.visibleIds().includes(tab.id)) this.syncAttachedView()
    this.emitChanged()
  }

  /** Tabs that should be on screen: the active tab, or both split panes. */
  private visibleIds(): string[] {
    if (this.panes) return [...this.panes]
    return this.activeId ? [this.activeId] : []
  }

  /** Ensures exactly the visible, healthy tabs' views are attached to the window. */
  private syncAttachedView(): void {
    if (this.window.isDestroyed()) return
    const desired = new Set(
      this.contentHidden
        ? []
        : this.visibleIds().filter((id) => {
            const tab = this.tabs.get(id)
            return tab && tab.status !== 'error' && tab.status !== 'crashed'
          })
    )

    for (const id of [...this.attachedIds]) {
      if (desired.has(id)) continue
      const tab = this.tabs.get(id)
      if (tab && !tab.view.webContents.isDestroyed()) this.window.contentView.removeChildView(tab.view)
      this.attachedIds.delete(id)
    }
    for (const id of desired) {
      if (this.attachedIds.has(id)) continue
      const tab = this.tabs.get(id)
      if (!tab) continue
      this.window.contentView.addChildView(tab.view)
      this.attachedIds.add(id)
    }
    this.updateLayout()
  }

  private focusActive(): void {
    const active = this.getActiveTab()
    if (active && this.attachedIds.has(active.id) && !active.view.webContents.isDestroyed()) {
      active.view.webContents.focus()
    }
  }

  private disposeTab(tab: Tab): void {
    if (this.attachedIds.has(tab.id)) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
      this.attachedIds.delete(tab.id)
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

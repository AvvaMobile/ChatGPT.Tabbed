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

export type GroupIndex = 0 | 1

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
  /** Column to open the tab in (split view); defaults to the focused column. */
  group?: GroupIndex
}

interface Group {
  ids: string[]
  activeId: string | null
}

interface TabManagerEvents {
  changed: []
}

/**
 * Owns every ChatGPT tab. Each tab has its own WebContentsView (own renderer, own navigation
 * history) while all of them share the single persistent `persist:chatgpt` session.
 *
 * Tabs live in one group (normal view) or two groups (split view: left and right column, each
 * with its own tab strip and active tab). Only each group's active tab is attached to the
 * window; the other views stay alive (detached) so their conversations continue where they
 * left off. "The active tab" means the active tab of the focused group.
 */
export class TabManager extends EventEmitter<TabManagerEvents> {
  private readonly tabs = new Map<string, Tab>()
  private groups: Group[] = [{ ids: [], activeId: null }]
  private focused: GroupIndex = 0
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

  // ---- queries --------------------------------------------------------------

  get isSplit(): boolean {
    return this.groups.length === 2
  }

  get size(): number {
    return this.tabs.size
  }

  getActiveId(): string | null {
    return this.groups[this.focused]?.activeId ?? null
  }

  getActiveTab(): Tab | null {
    const id = this.getActiveId()
    return id ? (this.tabs.get(id) ?? null) : null
  }

  getTab(id: string): Tab | null {
    return this.tabs.get(id) ?? null
  }

  groupOf(id: string): GroupIndex | null {
    const index = this.groups.findIndex((group) => group.ids.includes(id))
    return index === -1 ? null : (index as GroupIndex)
  }

  listTabs(): TabInfo[] {
    return this.groups.flatMap((group, groupIndex) =>
      group.ids.flatMap((id) => {
        const tab = this.tabs.get(id)
        if (!tab) return []
        const contents = tab.view.webContents
        const alive = !contents.isDestroyed()
        const selected = group.activeId === id
        const info: TabInfo = {
          id,
          title: this.displayTitle(tab),
          url: redactUrl(tab.url),
          active: selected && groupIndex === this.focused,
          selected,
          group: groupIndex as GroupIndex,
          renamed: tab.customTitle !== null,
          pane: this.isSplit && selected ? (groupIndex === 0 ? 'left' : 'right') : null,
          status: tab.status,
          error: tab.error,
          canGoBack: alive && contents.navigationHistory.canGoBack(),
          canGoForward: alive && contents.navigationHistory.canGoForward()
        }
        return [info]
      })
    )
  }

  // ---- tab lifecycle ----------------------------------------------------------

  createTab(options: CreateTabOptions = {}): Tab | null {
    if (this.destroyed || this.window.isDestroyed()) return null
    if (this.tabs.size >= MAX_TABS) {
      log.warn(`tab limit (${MAX_TABS}) reached`)
      return null
    }

    const groupIndex: GroupIndex =
      options.group !== undefined && options.group < this.groups.length ? options.group : this.focused
    const group = this.groups[groupIndex]
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

    // A deferred tab never becomes active on its own: when restoring, the saved active tabs are
    // activated explicitly afterwards.
    const lazy = options.lazy === true && options.activate === false
    const activate = !lazy && (options.activate !== false || group.activeId === null)
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
    group.ids.push(id)
    this.wireTab(tab)

    log.info(`created ${id} in column ${groupIndex}${lazy ? ' (deferred)' : ''}`)
    if (!lazy) this.load(tab, url)

    if (activate) this.activateTab(id)
    else this.emitChanged()
    return tab
  }

  /** Shows a tab in its column and focuses that column. */
  activateTab(id: string): boolean {
    const tab = this.tabs.get(id)
    const groupIndex = this.groupOf(id)
    if (!tab || groupIndex === null || this.destroyed) return false
    this.groups[groupIndex].activeId = id
    this.focused = groupIndex
    if (tab.pendingUrl) this.load(tab, tab.pendingUrl)
    this.syncAttachedViews()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
    return true
  }

  /**
   * Closes a tab and destroys its web contents. Emptying a column ends split view; closing the
   * very last tab opens a fresh one.
   */
  closeTab(id: string): boolean {
    const tab = this.tabs.get(id)
    const groupIndex = this.groupOf(id)
    if (!tab || groupIndex === null) return false
    const group = this.groups[groupIndex]

    const nextInGroup = group.activeId === id ? pickNextActiveTab(group.ids, id) : group.activeId
    group.ids = group.ids.filter((tabId) => tabId !== id)
    group.activeId = nextInGroup
    this.tabs.delete(id)
    this.disposeTab(tab)
    log.info(`closed ${id}`)
    if (this.destroyed) return true

    if (group.ids.length === 0 && this.isSplit) {
      // The other column becomes the only one.
      this.groups = [this.groups[groupIndex === 0 ? 1 : 0]]
      this.focused = 0
    }
    if (this.tabs.size === 0) {
      this.groups = [{ ids: [], activeId: null }]
      this.focused = 0
      this.createTab()
      return true
    }
    const active = this.getActiveId()
    if (active) this.activateTab(active)
    else this.emitChanged()
    return true
  }

  reloadTab(id: string | null = this.getActiveId(), ignoreCache = false): boolean {
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
    this.syncAttachedViews()
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
    this.syncAttachedViews()
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

  /** Cmd/Ctrl+1..9 within the focused column. */
  activateByShortcut(digit: number): void {
    const id = tabIdForShortcut(this.groups[this.focused].ids, digit)
    if (id) this.activateTab(id)
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab within the focused column. */
  activateAdjacent(delta: 1 | -1): void {
    const group = this.groups[this.focused]
    const id = adjacentTabId(group.ids, group.activeId, delta)
    if (id) this.activateTab(id)
  }

  // ---- split view -------------------------------------------------------------

  /**
   * Splits the window into two columns. The right column starts with `moveId` (moved out of
   * the left column) or, by default, a new chat. The right column gets the focus.
   */
  enableSplit(moveId?: string): void {
    if (this.isSplit || this.destroyed) return
    const left = this.groups[0]
    this.groups.push({ ids: [], activeId: null })
    if (moveId && left.ids.includes(moveId) && left.ids.length > 1) {
      if (left.activeId === moveId) left.activeId = pickNextActiveTab(left.ids, moveId)
      left.ids = left.ids.filter((id) => id !== moveId)
      this.groups[1].ids.push(moveId)
      this.activateTab(moveId)
      return
    }
    if (!this.createTab({ group: 1 })) {
      this.groups.pop()
      this.emitChanged()
    }
  }

  /** Adds an empty right column without opening a tab (used while restoring a saved split). */
  enableSplitEmpty(): void {
    if (!this.isSplit) this.groups.push({ ids: [], activeId: null })
  }

  /** Back to one column: the right column's tabs are appended to the left one. */
  disableSplit(): void {
    if (!this.isSplit) return
    const [left, right] = this.groups
    const active = this.getActiveId()
    this.groups = [{ ids: [...left.ids, ...right.ids], activeId: active ?? left.activeId }]
    this.focused = 0
    this.syncAttachedViews()
    if (!this.contentHidden) this.focusActive()
    this.emitChanged()
  }

  toggleSplit(): void {
    if (this.isSplit) this.disableSplit()
    else this.enableSplit()
  }

  /** Moves a tab to the other column (starting split view if needed). */
  moveToOtherSide(id: string): void {
    const from = this.groupOf(id)
    if (from === null) return
    if (!this.isSplit) {
      this.enableSplit(id)
      return
    }
    const source = this.groups[from]
    const target = this.groups[from === 0 ? 1 : 0]
    if (source.ids.length === 1) {
      // Moving the last tab of a column merges everything back into one column.
      this.disableSplit()
      return
    }
    if (source.activeId === id) source.activeId = pickNextActiveTab(source.ids, id)
    source.ids = source.ids.filter((tabId) => tabId !== id)
    target.ids.push(id)
    this.activateTab(id)
  }

  /** Makes a column the focused one (e.g. when the user clicks into it). */
  focusGroup(index: GroupIndex): void {
    if (index >= this.groups.length || this.focused === index) return
    this.focused = index
    this.emitChanged()
  }

  // ---- names, titles and persistence ---------------------------------------------

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

  /**
   * Tabs column by column, reduced to what is needed to reopen them later. `split` holds the
   * indexes of the two columns' active tabs.
   */
  snapshot(): { tabs: SavedTab[]; activeIndex: number; split: SavedSplit | null } {
    const tabs: SavedTab[] = []
    let activeIndex = 0
    const selected: number[] = []
    this.groups.forEach((group, groupIndex) => {
      for (const id of group.ids) {
        const tab = this.tabs.get(id)
        if (!tab) continue
        if (id === group.activeId) {
          selected[groupIndex] = tabs.length
          if (groupIndex === this.focused) activeIndex = tabs.length
        }
        tabs.push({
          url: restorableUrl(tab.pendingUrl ?? tab.url) ?? CHATGPT_HOME_URL,
          title: tab.pageTitle,
          customTitle: tab.customTitle,
          group: groupIndex as GroupIndex
        })
      }
    })
    const split =
      this.isSplit && selected[0] !== undefined && selected[1] !== undefined
        ? { left: selected[0], right: selected[1] }
        : null
    return { tabs, activeIndex, split }
  }

  // ---- layout -------------------------------------------------------------------

  /** Hide/show the web content area (e.g. while the Settings screen covers it). */
  setContentHidden(hidden: boolean): void {
    if (this.contentHidden === hidden) return
    this.contentHidden = hidden
    this.syncAttachedViews()
    if (!hidden) this.focusActive()
  }

  /** Recomputes the visible views' bounds from the current window content size. */
  updateLayout(): void {
    if (this.window.isDestroyed() || this.attachedIds.size === 0) return
    const [width, height] = this.window.getContentSize()
    if (this.isSplit) {
      const { left, right } = computeSplitBounds({ width, height })
      const leftId = this.groups[0].activeId
      const rightId = this.groups[1].activeId
      if (leftId) this.tabs.get(leftId)?.view.setBounds(left)
      if (rightId) this.tabs.get(rightId)?.view.setBounds(right)
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
    this.groups = [{ ids: [], activeId: null }]
    this.focused = 0
    this.attachedIds.clear()
    this.removeAllListeners()
  }

  /** Test/diagnostic helper: web contents ids of all live tabs. */
  webContentsIds(): number[] {
    return [...this.tabs.values()].flatMap((tab) =>
      tab.view.webContents.isDestroyed() ? [] : [tab.view.webContents.id]
    )
  }

  // ---- internals ------------------------------------------------------------------

  private wireTab(tab: Tab): void {
    const contents = tab.view.webContents

    applyNavigationPolicy(contents, {
      context: 'tab',
      // ChatGPT links that open a new window become a tab in the same column.
      openInNewTab: (url) => this.createTab({ url, group: this.groupOf(tab.id) ?? this.focused })
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

    // Clicking into a column makes it the focused one.
    contents.on('focus', () => {
      const groupIndex = this.groupOf(tab.id)
      if (groupIndex !== null && this.groups[groupIndex].activeId === tab.id) this.focusGroup(groupIndex)
    })

    contents.on('unresponsive', () => log.warn(`${tab.id} became unresponsive`))
    contents.on('responsive', () => log.info(`${tab.id} is responsive again`))
  }

  private displayTitle(tab: Tab): string {
    return tab.customTitle ?? (tab.pageTitle || DEFAULT_TAB_TITLE)
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
    if (this.visibleIds().includes(tab.id)) this.syncAttachedViews()
    this.emitChanged()
  }

  /** Tabs that should be on screen: each column's active tab. */
  private visibleIds(): string[] {
    return this.groups.flatMap((group) => (group.activeId ? [group.activeId] : []))
  }

  /** Ensures exactly the visible, healthy tabs' views are attached to the window. */
  private syncAttachedViews(): void {
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

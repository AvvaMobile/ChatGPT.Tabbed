import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { MAX_TAB_NAME_LENGTH } from '@shared/constants'
import type { AppState, TabInfo } from '@shared/ipc'
import { BackIcon, ChatIcon, CloseIcon, ForwardIcon, PlusIcon, ReloadIcon, SettingsIcon, SplitIcon } from './Icons'

const api = window.chatgptTabs

function TabNameEditor({ tab, onDone }: { tab: TabInfo; onDone: () => void }) {
  const [value, setValue] = useState(tab.title)
  const done = useRef(false)

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save && value.trim() !== tab.title) void api.renameTab(tab.id, value.trim() || null)
    onDone()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
    event.stopPropagation()
  }

  return (
    <input
      className="tab__input"
      data-testid="tab-name-input"
      aria-label="Tab name"
      value={value}
      maxLength={MAX_TAB_NAME_LENGTH}
      placeholder="Tab name"
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

function Tab({ tab, editing, onEdit }: { tab: TabInfo; editing: boolean; onEdit: (id: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab.active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab.active])

  const onMouseDown = (event: MouseEvent) => {
    if (event.button === 0) void api.activateTab(tab.id)
  }
  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault()
      void api.closeTab(tab.id)
    }
  }
  const onClose = (event: MouseEvent) => {
    event.stopPropagation()
    void api.closeTab(tab.id)
  }

  const failed = tab.status === 'error' || tab.status === 'crashed'
  const tooltip = tab.renamed ? `${tab.title} (renamed — double-click to edit)` : `${tab.title} (double-click to rename)`

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={tab.active}
      title={tooltip}
      aria-label={tab.title}
      data-testid="tab"
      data-tab-id={tab.id}
      data-active={tab.active}
      className={`tab${tab.active ? ' tab--active' : tab.selected ? ' tab--selected' : ''}`}
      data-title={tab.title}
      data-renamed={tab.renamed}
      data-pane={tab.pane ?? undefined}
      onMouseDown={onMouseDown}
      onAuxClick={onAuxClick}
      onDoubleClick={() => onEdit(tab.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        void api.showTabMenu(tab.id)
      }}
    >
      <span className="tab__icon" aria-hidden>
        {tab.status === 'loading' ? (
          <span className="spinner" />
        ) : failed ? (
          <span className="tab__error-dot" />
        ) : (
          <ChatIcon />
        )}
      </span>
      {editing ? (
        <TabNameEditor tab={tab} onDone={() => onEdit(null)} />
      ) : (
        <span className="tab__title">{tab.title}</span>
      )}
      <button
        type="button"
        className="tab__close"
        aria-label={`Close ${tab.title}`}
        data-testid="tab-close"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

interface StripProps {
  tabs: TabInfo[]
  group: 0 | 1
  label: string
  editingId: string | null
  onEdit: (id: string | null) => void
}

/** One row of tabs plus its own "new tab" button (one per column in split view). */
function TabStrip({ tabs, group, label, editingId, onEdit }: StripProps) {
  return (
    <div className="tabs" role="tablist" aria-label={label} data-testid={`tab-strip-${group}`}>
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} editing={editingId === tab.id} onEdit={onEdit} />
      ))}
      <button
        type="button"
        className="icon-button new-tab"
        aria-label={`New tab (${label})`}
        title="New tab"
        data-testid={group === 0 ? 'new-tab' : 'new-tab-right'}
        onClick={() => void api.createTab(group)}
      >
        <PlusIcon />
      </button>
    </div>
  )
}

export function TabBar({ state }: { state: AppState }) {
  const active = state.tabs.find((tab) => tab.active)
  const [editingId, setEditingId] = useState<string | null>(null)
  const focusedGroup = active?.group ?? 0

  // "Rename Tab…" from the app menu or the tab's context menu.
  useEffect(() => api.onBeginRename((id) => setEditingId(id)), [])

  const nav = (
    <div className="topbar__nav">
      <button
        type="button"
        className="icon-button"
        aria-label="Back"
        title="Back"
        disabled={!active?.canGoBack || state.settingsOpen}
        onClick={() => void api.goBack()}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Forward"
        title="Forward"
        disabled={!active?.canGoForward || state.settingsOpen}
        onClick={() => void api.goForward()}
      >
        <ForwardIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Reload"
        title="Reload"
        data-testid="reload"
        disabled={!active || state.settingsOpen}
        onClick={() => void api.reloadTab()}
      >
        <ReloadIcon />
      </button>
    </div>
  )
  const actions = (
      <div className="topbar__actions">
        <button
          type="button"
          className={`icon-button${state.split ? ' icon-button--on' : ''}`}
          aria-label="Split view"
          aria-pressed={state.split}
          title={state.split ? 'Close split view' : 'Split view: two tabs side by side'}
          data-testid="split-button"
          onClick={() => void api.toggleSplit()}
        >
          <SplitIcon />
        </button>
        <button
          type="button"
          className={`icon-button${state.settingsOpen ? ' icon-button--on' : ''}`}
          aria-label="Settings"
          aria-pressed={state.settingsOpen}
          title="Settings"
          data-testid="settings-button"
          onClick={() => void (state.settingsOpen ? api.closeSettings() : api.openSettings())}
        >
          <SettingsIcon />
        </button>
      </div>
  )

  if (state.split) {
    const left = state.tabs.filter((tab) => tab.group === 0)
    const right = state.tabs.filter((tab) => tab.group === 1)
    return (
      <header className="topbar topbar--split" data-fullscreen={state.fullscreen}>
        <div className={`topbar__half topbar__half--left${focusedGroup === 0 ? ' topbar__half--focused' : ''}`}>
          {nav}
          <TabStrip tabs={left} group={0} label="Left column tabs" editingId={editingId} onEdit={setEditingId} />
        </div>
        <div className="topbar__divider" />
        <div className={`topbar__half topbar__half--right${focusedGroup === 1 ? ' topbar__half--focused' : ''}`}>
          <TabStrip tabs={right} group={1} label="Right column tabs" editingId={editingId} onEdit={setEditingId} />
          {actions}
        </div>
      </header>
    )
  }

  return (
    <header className="topbar" data-fullscreen={state.fullscreen}>
      {nav}
      <TabStrip tabs={state.tabs} group={0} label="ChatGPT tabs" editingId={editingId} onEdit={setEditingId} />
      {actions}
    </header>
  )
}

import { useEffect, useRef, type MouseEvent } from 'react'
import type { AppState, TabInfo } from '@shared/ipc'
import { BackIcon, ChatIcon, CloseIcon, ForwardIcon, PlusIcon, ReloadIcon, SettingsIcon } from './Icons'

const api = window.chatgptTabs

function Tab({ tab }: { tab: TabInfo }) {
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

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={tab.active}
      title={tab.title}
      data-testid="tab"
      data-tab-id={tab.id}
      data-active={tab.active}
      className={`tab${tab.active ? ' tab--active' : ''}`}
      onMouseDown={onMouseDown}
      onAuxClick={onAuxClick}
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
      <span className="tab__title">{tab.title}</span>
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

export function TabBar({ state }: { state: AppState }) {
  const active = state.tabs.find((tab) => tab.active)

  return (
    <header className="topbar" data-fullscreen={state.fullscreen}>
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

      <div className="tabs" role="tablist" aria-label="ChatGPT tabs">
        {state.tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} />
        ))}
        <button
          type="button"
          className="icon-button new-tab"
          aria-label="New tab"
          title="New tab"
          data-testid="new-tab"
          onClick={() => void api.createTab()}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="topbar__actions">
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
    </header>
  )
}

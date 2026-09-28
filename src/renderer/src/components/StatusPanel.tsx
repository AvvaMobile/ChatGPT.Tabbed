import type { TabInfo } from '@shared/ipc'
import { WarningIcon } from './Icons'

const api = window.chatgptTabs

/** Shown in place of the ChatGPT view when the active tab failed to load or crashed. */
export function StatusPanel({ tab }: { tab: TabInfo }) {
  const crashed = tab.status === 'crashed'
  return (
    <section className="status-panel" data-testid="status-panel" role="alert">
      <WarningIcon className="status-panel__icon" />
      <h1>{crashed ? 'This tab stopped working' : 'ChatGPT could not be loaded'}</h1>
      <p>
        {crashed
          ? 'The page closed unexpectedly. Reloading will restore ChatGPT in this tab.'
          : 'Check your internet connection and try again.'}
      </p>
      {tab.error && (
        <p className="status-panel__detail">
          {tab.error.description}
          {!crashed && tab.error.code ? ` (${tab.error.code})` : ''}
        </p>
      )}
      <button type="button" className="button button--primary" data-testid="retry" onClick={() => void api.reloadTab(tab.id)}>
        {crashed ? 'Reload tab' : 'Retry'}
      </button>
    </section>
  )
}

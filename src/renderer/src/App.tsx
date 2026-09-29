import type { TabInfo } from '@shared/ipc'
import { Settings } from './components/Settings'
import { StatusPanel } from './components/StatusPanel'
import { TabBar } from './components/TabBar'
import { useAppState } from './useAppState'

function PaneContent({ tab }: { tab: TabInfo | undefined }) {
  const failed = tab && (tab.status === 'error' || tab.status === 'crashed')
  return failed ? <StatusPanel tab={tab} /> : <div className="content__placeholder" aria-hidden />
}

export function App() {
  const state = useAppState()
  const active = state.tabs.find((tab) => tab.active)
  const left = state.tabs.find((tab) => tab.pane === 'left')
  const right = state.tabs.find((tab) => tab.pane === 'right')

  return (
    <div className="app">
      <TabBar state={state} />
      {/* The ChatGPT WebContentsView is layered over this area by the main process. */}
      <div className="content">
        {state.settingsOpen ? (
          <Settings loginWindowOpen={state.loginWindowOpen} />
        ) : state.split ? (
          <div className="split" data-testid="split">
            <div className="split__cell">
              <PaneContent tab={left} />
            </div>
            <div className="split__divider" />
            <div className="split__cell">
              <PaneContent tab={right} />
            </div>
          </div>
        ) : (
          <PaneContent tab={active} />
        )}
      </div>
    </div>
  )
}

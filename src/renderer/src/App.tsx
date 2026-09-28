import { Settings } from './components/Settings'
import { StatusPanel } from './components/StatusPanel'
import { TabBar } from './components/TabBar'
import { useAppState } from './useAppState'

export function App() {
  const state = useAppState()
  const active = state.tabs.find((tab) => tab.active)
  const failed = active && (active.status === 'error' || active.status === 'crashed')

  return (
    <div className="app">
      <TabBar state={state} />
      {/* The ChatGPT WebContentsView is layered over this area by the main process. */}
      <div className="content">
        {state.settingsOpen ? (
          <Settings loginWindowOpen={state.loginWindowOpen} />
        ) : failed ? (
          <StatusPanel tab={active} />
        ) : (
          <div className="content__placeholder" aria-hidden />
        )}
      </div>
    </div>
  )
}

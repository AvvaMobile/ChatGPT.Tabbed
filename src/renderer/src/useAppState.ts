import { useEffect, useState } from 'react'
import type { AppState } from '@shared/ipc'

const EMPTY_STATE: AppState = {
  tabs: [],
  activeTabId: null,
  settingsOpen: false,
  fullscreen: false,
  loginWindowOpen: false
}

/** Mirrors the main-process app state; main pushes a fresh snapshot after every change. */
export function useAppState(): AppState {
  const [state, setState] = useState<AppState>(EMPTY_STATE)

  useEffect(() => {
    let active = true
    const unsubscribe = window.chatgptTabs.onStateChanged((next) => {
      if (active) setState(next)
    })
    window.chatgptTabs.getState().then((initial) => {
      if (active) setState(initial)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}

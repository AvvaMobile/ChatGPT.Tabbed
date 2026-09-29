import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, AppSettings } from '@shared/ipc'
import { CloseIcon } from './Icons'

const api = window.chatgptTabs
const isMac = api.platform === 'darwin'
const mod = isMac ? '⌘' : 'Ctrl+'

const SHORTCUTS: Array<[string, string]> = [
  [`${mod}T`, 'New tab'],
  [`${mod}W`, 'Close tab'],
  [`${mod}R`, 'Reload tab'],
  [`${mod}1 … ${mod}8`, 'Go to tab 1–8'],
  [`${mod}9`, 'Go to last tab'],
  [isMac ? '⌘⇧E' : 'Ctrl+Shift+E', 'Rename tab (or double-click it)'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
  [isMac ? '⌘[ / ⌘]' : 'Alt+← / Alt+→', 'Back / forward'],
  [isMac ? '⌘,' : 'Ctrl+,', 'Settings']
]

type AuthState = 'checking' | 'signed-in' | 'signed-out'

export function Settings({ loginWindowOpen }: { loginWindowOpen: boolean }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const refreshAuth = useCallback(
    () => api.getAuthStatus().then((status) => setAuth(status.signedIn ? 'signed-in' : 'signed-out')),
    []
  )

  useEffect(() => {
    void api.getInfo().then(setInfo)
    void api.getSettings().then(setSettings)
  }, [])

  const onToggleRestore = async (restoreTabs: boolean) => {
    setSettings(await api.setSettings({ restoreTabs }))
  }

  // Re-check whenever the login window opens or closes.
  useEffect(() => {
    let current = true
    api.getAuthStatus().then((status) => {
      if (current) setAuth(status.signedIn ? 'signed-in' : 'signed-out')
    })
    return () => {
      current = false
    }
  }, [loginWindowOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void api.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onClear = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.clearSession()
      if (result.cleared) setMessage('ChatGPT session cleared. You are now signed out.')
      await refreshAuth()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="settings" data-testid="settings">
      <div className="settings__inner">
        <header className="settings__header">
          <h1>Settings</h1>
          <button type="button" className="icon-button" aria-label="Close settings" data-testid="settings-close" onClick={() => void api.closeSettings()}>
            <CloseIcon />
          </button>
        </header>

        <section className="card">
          <div className="card__head">
            <h2>ChatGPT account</h2>
            <span className={`pill pill--${auth}`} data-testid="auth-status">
              {auth === 'checking' ? 'Checking…' : auth === 'signed-in' ? 'Signed in' : 'Not signed in'}
            </span>
          </div>
          <p className="muted">
            Sign in once with your normal ChatGPT account. The login is kept in this app&apos;s persistent browser
            session and shared by all tabs. The app never sees or stores your password.
          </p>
          <div className="row">
            <button type="button" className="button button--primary" data-testid="open-login" onClick={() => void api.openLogin()}>
              {loginWindowOpen ? 'Show Login Window' : 'Open ChatGPT Login'}
            </button>
            <button type="button" className="button button--danger" data-testid="clear-session" disabled={busy} onClick={() => void onClear()}>
              Clear ChatGPT Session
            </button>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Tabs</h2>
          <label className="toggle">
            <span>
              <strong>Reopen tabs when the app starts</strong>
              <span className="muted">
                Brings back your open chats, their order and any names you gave them. Only the chat links and tab
                names are saved on this computer; clearing the ChatGPT session also removes them.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              data-testid="restore-tabs"
              checked={settings?.restoreTabs ?? false}
              disabled={!settings}
              onChange={(event) => void onToggleRestore(event.target.checked)}
            />
          </label>
        </section>

        <section className="card">
          <h2>Keyboard shortcuts</h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={label} className="shortcuts__row">
                <dt>{label}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card" data-testid="about">
          <h2>About</h2>
          <p className="muted">
            {info?.name ?? 'ChatGPT Tabs'} is a tabbed desktop wrapper around the ChatGPT website. It has no telemetry,
            no analytics and no server of its own; it talks only to ChatGPT and the sign-in providers you choose. Not
            affiliated with OpenAI.
          </p>
          {info && (
            <dl className="about">
              <dt>Version</dt>
              <dd data-testid="about-version">{info.version}</dd>
              <dt>Electron</dt>
              <dd>{info.electron}</dd>
              <dt>Chromium</dt>
              <dd>{info.chrome}</dd>
              <dt>Platform</dt>
              <dd>
                {info.platform} ({info.arch})
              </dd>
              <dt>Session</dt>
              <dd data-testid="about-partition">
                <code>{info.partition}</code>
              </dd>
            </dl>
          )}
        </section>
      </div>
    </main>
  )
}

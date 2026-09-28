# ChatGPT Tabs

A **Chrome-style tabbed** desktop client for the ChatGPT web app (Electron + TypeScript).

- Every tab is its own `WebContentsView` (own renderer process, own navigation history, own conversation).
- All tabs share **one persistent session** (`persist:chatgpt`): sign in once and every tab, and every future launch, stays signed in.
- Not a general-purpose browser: no address bar, bookmarks or history manager. Links outside ChatGPT open in the system browser.
- Not an OpenAI API client; no API key needed. It uses your existing ChatGPT web account.
- **No** telemetry, analytics, backend server or auto-update.

> ChatGPT Tabs is an independent wrapper and is not affiliated with OpenAI.

---

## Contents

1. [Quick start](#quick-start)
2. [Scripts](#scripts)
3. [Package output (.app / .dmg)](#package-output-app--dmg)
4. [First ChatGPT login](#first-chatgpt-login)
5. [Clearing the session](#clearing-the-session)
6. [Keyboard shortcuts](#keyboard-shortcuts)
7. [Security model](#security-model)
8. [Privacy](#privacy)
9. [Architecture](#architecture)
10. [Tests](#tests)
11. [Known limitations](#known-limitations)
12. [Troubleshooting](#troubleshooting)

---

## Quick start

Requirement: Node.js 20+ (developed with Node 24). Electron is **not** installed globally; it comes in as a project `devDependency`.

```bash
npm install        # dependencies + Electron binary
npm run dev        # development mode (UI with hot reload)
```

Production package:

```bash
npm run package    # typecheck + build + macOS .app and .dmg
open "release/mac-arm64/ChatGPT Tabs.app"
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server + Electron, hot reload for the UI |
| `npm start` | Runs the compiled `out/` folder with Electron (preview) |
| `npm run build` | Typecheck + production build (`out/main`, `out/preload`, `out/renderer`) |
| `npm run typecheck` | `tsc --noEmit` for main/preload, renderer and test code |
| `npm run lint` | ESLint (typescript-eslint + react-hooks) |
| `npm test` | Unit tests (Vitest) + Electron E2E tests (Playwright) |
| `npm run test:unit` | Unit tests only |
| `npm run test:e2e` | Build + Playwright tests against the real Electron app |
| `npm run package` | macOS `.app` + `.dmg` (arm64 on Apple Silicon) |
| `npm run package:win` / `package:linux` | Windows NSIS / Linux AppImage (run on that OS) |
| `npm run smoke:package` | Launches the packaged app with an isolated profile and smoke-tests it automatically |
| `npm run verify` | lint → typecheck → test → package → smoke:package (everything) |

## Package output (.app / .dmg)

After `npm run package`:

```
release/
├── mac-arm64/ChatGPT Tabs.app        # runnable application
└── ChatGPT Tabs-1.0.0-arm64.dmg      # drag-and-drop installer image
```

(On an Intel Mac the folder is `mac-x64` and the file ends in `-x64.dmg`.)

**Code signing:** there is no Apple Developer certificate, so the app is **ad-hoc signed** (`identity: "-"`). It opens without issues on the machine that built it. If you move the `.dmg` to another Mac, Gatekeeper shows an "unidentified developer" warning; right-click the app in Finder → **Open** once to approve it. For distribution, replace `mac.identity` in `electron-builder.yml` with a real Developer ID and add notarization.

## First ChatGPT login

1. Open the app. A ChatGPT tab opens automatically.
2. Click the **⚙ Settings** button at the top right (or press `⌘,` / `Ctrl+,`).
3. Click **Open ChatGPT Login**. A separate sign-in window opens that uses the same persistent session.
4. Sign in **manually, as usual** with email/password, Google, Microsoft or Apple (MFA included). Enterprise SSO flows also work inside the window.
5. Once the sign-in is detected, the window closes itself and the open tabs reload. If you close the window yourself, the tabs reload as well.
6. Settings now shows **Signed in**.

Alternative: the **Log in** button inside any ChatGPT tab signs in to the same session.

After quitting and reopening the app you are not asked to sign in again as long as the ChatGPT session cookie has not expired. The session also survives app updates, because the partition name is fixed (`persist:chatgpt`) and the user data directory is tied to the app name.

Where the session data lives on disk:

| OS | Location |
| --- | --- |
| macOS | `~/Library/Application Support/ChatGPT Tabs/Partitions/chatgpt/` |
| Windows | `%APPDATA%\ChatGPT Tabs\Partitions\chatgpt\` |
| Linux | `~/.config/ChatGPT Tabs/Partitions/chatgpt/` |

## Clearing the session

Settings → **Clear ChatGPT Session** → **Clear Session** in the confirmation dialog.

This deletes **all cookies, cache, localStorage/IndexedDB/service worker data and the HTTP auth cache** of the ChatGPT partition, flushes the cookie store to disk, closes an open login window and sends every tab back to the ChatGPT start page. Result: signed out in all tabs. Your conversations stay in your ChatGPT account; only local data on this computer is removed.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New tab | `⌘T` | `Ctrl+T` |
| Close active tab | `⌘W` | `Ctrl+W` |
| Reload active tab | `⌘R` | `Ctrl+R` |
| Reload without cache | `⌘⇧R` | `Ctrl+Shift+R` |
| Go to tab 1–8 | `⌘1` … `⌘8` | `Ctrl+1` … `Ctrl+8` |
| Go to last tab | `⌘9` | `Ctrl+9` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+⇧Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Back / forward | `⌘[` / `⌘]` | `Alt+←` / `Alt+→` |
| Settings | `⌘,` | `Ctrl+,` |
| Zoom | `⌘+` / `⌘-` / `⌘0` | `Ctrl++` / `Ctrl+-` / `Ctrl+0` |
| DevTools for tab | `⌥⌘I` | `Ctrl+Shift+I` |

Shortcuts are application-menu accelerators, so they work whether focus is in the tab bar or on the ChatGPT page. Middle-clicking a tab closes it. Closing the last tab does not quit the app; a fresh tab opens instead.

---

## Security model

Core assumption: **remote ChatGPT content is untrusted**, the app's own local UI (tab bar/settings) is trusted. There is a clear trust boundary between the two.

### Process and isolation settings

| Component | `sandbox` | `contextIsolation` | `nodeIntegration` | Preload |
| --- | --- | --- | --- | --- |
| ChatGPT tabs (`WebContentsView`) | ✅ true | ✅ true | ❌ false | **none** |
| Login window | ✅ true | ✅ true | ❌ false | **none** |
| OAuth popups | ✅ true | ✅ true | ❌ false | **none** |
| Local UI (tab bar) | ✅ true | ✅ true | ❌ false | minimal, typed bridge |

In addition, all remote content uses `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, `nodeIntegrationInSubFrames: false`, `safeDialogs: true`. A global `will-attach-webview` block means no `<webview>` can be created anywhere. `enableRemoteModule` / `@electron/remote` are not used. These settings are verified in the E2E tests against the real `WebContents` (including that `require`, `process` and the bridge object are **undefined** in a tab page).

### IPC surface

- ChatGPT pages have **no preload at all**, so they cannot reach IPC.
- The local UI gets only fixed functions through `contextBridge` (`createTab`, `closeTab`, `openLogin`, `clearSession`, …). There is **no** generic `invoke`/`send`, file system, shell or command execution.
- Every handler in the main process validates the caller: the sender must be the main window's `webContents` **and** its main frame **and** the frame URL must be the app's own UI (packaged `file://…/renderer/index.html` or the dev server). Anything else is rejected.
- Arguments are validated (e.g. a tab id must match `^tab-[1-9][0-9]{0,8}$`). Tested: `activateTab('../../etc')` is rejected.

### Navigation policy (`src/main/security/navigationPolicy.ts`)

A pure (Electron-free), unit-tested function:

| Target | Behaviour |
| --- | --- |
| `https://chatgpt.com`, its subdomains, `chat.openai.com` | Stays in the app |
| Sign-in providers: `auth.openai.com`, `auth0.openai.com`, `accounts.google.com`, `login.microsoftonline.com`, `login.live.com`, `appleid.apple.com`, Cloudflare challenge, `pay.openai.com` / Stripe checkout | Stays in the app (so login/upgrade flows keep working) |
| Any `https` target while the page is already on a sign-in provider | Allowed (enterprise SSO: Okta, Entra ID, etc.) |
| Other `http(s)` and `mailto:` | Opened in the **system browser** via `shell.openExternal`, never inside the app |
| `file:`, `javascript:`, `chrome:`, custom schemes, malformed URLs | **Blocked** |

- Only `http`, `https` and `mailto` are ever passed to `shell.openExternal`; no other scheme reaches the operating system.
- Both `will-navigate` and main-frame `will-redirect` are checked (including script-driven `location.href` changes).
- `window.open` / `target=_blank`: ChatGPT link → new app tab; OAuth → sandboxed popup that inherits the same session; external link → system browser; anything else → denied.
- A blank popup opened for an external page is closed after the link is handed to the system browser.
- Iframes (Cloudflare Turnstile, payment widgets) are left alone; the allowlist deliberately does not block ChatGPT's API/CDN requests.

### Permissions

- In the ChatGPT partition, only the **chatgpt.com origin** gets permissions, and only these: `media` (microphone/camera for voice chat), `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, `notifications`. Every other permission request and every other origin is denied.
- The default session used by the local UI gets **no permissions at all**.
- `Info.plist` usage descriptions are included for macOS microphone/camera access; the system asks on first use.

### Credentials and cookies

- The app **never reads, stores or logs** passwords, MFA codes, tokens or cookie values. Sign-in happens manually on the real web pages; there is no autofill or password capture.
- The session lives in Electron's own cookie/storage mechanism (`persist:chatgpt`). The app has no separate config file or database.
- For the "Signed in" status the app only checks **whether** the session cookie exists; its value is never read.
- URLs in logs are reduced to `origin + path` by `redactUrl` (query parameters such as OAuth `code`, `state` or tokens, and any `user:pass@` part, are dropped). Debug/info logs are off in production; only warnings/errors are written.
- The cookie store is flushed to disk on quit, so the login survives restarts.

### User-Agent

Electron appends `Electron/x.y` and app-name tokens to its default User-Agent, which makes providers like Google reject the sign-in as an "insecure browser". The app **removes these two tokens**; what remains is the real Chrome UA of the bundled Chromium. No other identity is spoofed, and no security mechanism (CAPTCHA, Cloudflare, MFA) is bypassed.

### Package hardening (Electron Fuses)

`electron-builder.yml` → `electronFuses`:

| Fuse | Value | Meaning |
| --- | --- | --- |
| `RunAsNode` | off | The app binary cannot be used as Node via `ELECTRON_RUN_AS_NODE` |
| `EnableNodeOptionsEnvironmentVariable` | off | No code injection through `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | off | No debugger attach to the main process via `--inspect` |
| `EnableEmbeddedAsarIntegrityValidation` | on | The app refuses to start if `app.asar` was modified |
| `OnlyLoadAppFromAsar` | on | Code is only loaded from the integrity-checked `app.asar` |
| `EnableCookieEncryption` | off | See [limitations](#known-limitations) |

Other measures: single-instance lock (one profile cannot be opened by two processes), strict CSP on the local UI (`script-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`), the local UI never navigates or opens windows (a file dropped on the tab bar cannot replace the UI), and OAuth popups are sandboxed too.

---

## Privacy

- The app has **no network traffic of its own**: no telemetry, analytics, crash reporting or update checks.
- The only network traffic is that of the ChatGPT page in your tabs and of the sign-in provider you choose.
- Conversation content is never sent to any third party and is not read by the app.
- No script is injected into the ChatGPT DOM; the page's HTML/CSS is not touched.

---

## Architecture

```
src/
├── shared/                   # shared by main/preload/renderer: constants, IPC channels/types, validation
├── main/
│   ├── index.ts              # app lifecycle: single instance, ready, activate (dock), flush on before-quit
│   ├── AppController.ts      # window + TabManager + LoginWindow + settings state; publishes state to the UI
│   ├── menu.ts               # application menu = keyboard shortcuts
│   ├── logger.ts             # verbose logs in dev only, never sensitive data
│   ├── tabs/
│   │   ├── TabManager.ts     # createTab/activateTab/closeTab/reloadTab/getActiveTab/listTabs/updateTabTitle/destroyAllTabs
│   │   ├── tabOrder.ts       # pure helpers (which tab after close, ⌘1-9, Ctrl+Tab)
│   │   └── contextMenu.ts    # native right-click menu (copy/paste, links, images, spell check)
│   ├── session/
│   │   ├── chatgptSession.ts # persist:chatgpt: permissions, downloads, UA, signed-in check, clearing, flush
│   │   └── userAgent.ts
│   ├── auth/LoginWindow.ts   # sign-in window on the same partition, and its lifecycle
│   ├── security/
│   │   ├── navigationPolicy.ts   # pure decision functions (unit-tested)
│   │   ├── webContentsPolicy.ts  # wires the policy into will-navigate/will-redirect/window.open
│   │   └── externalLinks.ts      # safe shell.openExternal
│   ├── ipc/registerIpc.ts    # IPC handlers with sender + argument validation
│   └── window/               # main window, layout (view bounds), theme colours
├── preload/index.ts          # minimal contextBridge API for the local UI only
└── renderer/                 # React UI: TabBar, Settings, error/crash panel
```

**Tab lifecycle.** Each tab is created as a new `WebContentsView` on the `persist:chatgpt` partition and opens `https://chatgpt.com/` (the active tab's URL is not cloned). **Only the active tab's view** is attached to the window; inactive views are detached but **not destroyed**, so conversations (including streaming answers) continue where they left off. Closing a tab removes its view from the window and destroys it explicitly with `webContents.close()` (WebContentsView does not do this on garbage collection). When the window closes or the app quits, `destroyAllTabs()` closes every web contents. On macOS, clicking the dock icon opens a new window with a fresh tab.

**Layout.** The view position comes from a single pure function (`computeTabViewBounds`): the whole area below the tab bar (40 DIP). It is recomputed on `resize`, `maximize`, `restore` and fullscreen events. Values are in DIPs; Electron handles the Retina/HiDPI conversion. macOS uses the `hiddenInset` title bar with space reserved on the left of the tab bar for the traffic lights (removed in fullscreen). On Windows/Linux, `titleBarOverlay` keeps the native window buttons.

**Settings and error screens** are drawn by the local UI; while they are visible the active ChatGPT view is detached (native views sit above the HTML, so this is used instead of an overlay).

**Error handling.** Main-frame `did-fail-load` (except the aborted `-3`) → tab goes to the `error` state, "ChatGPT could not be loaded" + **Retry**. `render-process-gone` → "This tab stopped working" + **Reload tab**. If the local UI's renderer crashes it reloads automatically. Tab titles update from the `page-title-updated` event, not by polling.

**Downloads.** Electron's native download handling is kept: the save dialog suggests `~/Downloads/<file name>`; on macOS the Downloads stack bounces in the dock when finished. File upload (native file picker), drag and drop and copy/paste work through ChatGPT's own mechanisms, untouched.

**Stack.** Electron 44 (`WebContentsView`, no BrowserView), TypeScript 6, electron-vite 5 / Vite 7, React 19, electron-builder 26, Vitest 5, Playwright 1.63, ESLint 10.

---

## Tests

```bash
npm run test:unit    # 21 tests: navigation policy, URL redaction, UA, layout, tab order, id validation
npm run test:e2e     # 16 tests against the real Electron app
npm run smoke:package
```

The E2E tests need no real ChatGPT account or network: each test uses an isolated temporary profile directory (`CHATGPT_TABS_USER_DATA_DIR`), `chatgpt.com` requests are routed to a local stub page inside the test, and `shell.openExternal` is replaced by a recorder. Coverage:

- one tab on launch with correct view bounds; separate `WebContents` per tab, all on the same persistent `persist:chatgpt` session; sandbox/contextIsolation/nodeIntegration/preload checks
- new tabs start clean, navigation state is preserved when switching tabs, back/forward
- menu shortcuts (new/close/⌘1-9/Ctrl+Tab) and accelerator values
- closing a tab destroys its `WebContents`; closing the last tab opens a new one
- reload (button + menu), settings screen, login window (same session, sign-in detection, closing, tab reload)
- clearing the session (cookies + localStorage removed); external link / `target=_blank` / script redirect → system browser; `file:` blocked; ChatGPT popup → new tab
- bounds on window resize, load failure + Retry, renderer crash + recovery, invalid IPC rejected
- closing the window cleans up every tab `WebContents` + reopening from the dock; cookies survive an app restart

`smoke:package` launches the packaged `.app` with an isolated profile, connects over CDP and verifies that the UI loads from `app.asar`, real `https://chatgpt.com` opens, tabs can be opened/switched/closed, and Settings works.

Signing in with a real ChatGPT account is intentionally not automated. Manual smoke test: open the app → Settings → Open ChatGPT Login → sign in → quit and reopen the app → you should still be signed in.

---

## Known limitations

- **No code signing / notarization.** The app is ad-hoc signed; on another Mac the first launch needs Gatekeeper approval.
- **Cookies are stored unencrypted on disk** (`EnableCookieEncryption` off, the Electron default). Turning it on depends on the Keychain, and with unsigned/ad-hoc signed builds every new build triggers a Keychain permission prompt. If you sign with a real Developer ID, enabling it is recommended (the existing session is reset once when you do). The profile folder is only accessible to your user account; FileVault is recommended.
- **Google/Microsoft/Apple sign-in** may occasionally restrict embedded browsers again. If that happens, use ChatGPT email + password sign-in or the "Log in" button inside a tab.
- **Under automation** (`navigator.webdriver = true`) ChatGPT redirects signed-out users straight to Google sign-in, which is why the E2E tests use a stub page. This does not happen in normal use (verified in the package smoke test).
- **Inactive tabs** are subject to Chromium's background throttling: a streaming answer keeps going, but the screen updates when you switch back to the tab. Each tab is a separate renderer process, so memory use grows with the number of tabs; a maximum of 50 tabs can be open as a safeguard.
- **Open tabs are not restored on restart**; every launch starts with one clean tab (conversations are available from ChatGPT's left sidebar).
- **No auto-update**; rerun `npm run package` for a new version.
- `blob:` URLs (some previews ChatGPT opens "in a new window") open in a small sandboxed window.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Tab shows "ChatGPT could not be loaded" | Check your internet connection and press **Retry** |
| "This tab stopped working" | Press **Reload tab** |
| Tabs still look signed out after login | Reload the tab with `⌘R`; if that fails, Settings → Clear ChatGPT Session → sign in again |
| The app does not open a second time | Single-instance lock: the existing window comes to the front |
| Need verbose logs | `CHATGPT_TABS_DEBUG=1 "release/mac-arm64/ChatGPT Tabs.app/Contents/MacOS/ChatGPT Tabs"` (no sensitive data is logged) |
| Try a separate/clean profile | Launch with `CHATGPT_TABS_USER_DATA_DIR=/tmp/profile ...` |

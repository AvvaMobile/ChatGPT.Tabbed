import { app, session, type Session } from 'electron'
import { join } from 'node:path'
import { CHATGPT_PARTITION } from '@shared/constants'
import { createLogger } from '../logger'
import { isChatGptUrl, parseUrl, redactUrl } from '../security/navigationPolicy'
import { toChromeUserAgent } from './userAgent'

const log = createLogger('session')

/** Permissions ChatGPT legitimately uses (voice mode, copy buttons, fullscreen video, notifications). */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'notifications'
])

/** Cookie name prefix the ChatGPT web app uses for its (possibly chunked) session token. */
const SESSION_COOKIE_PREFIX = '__Secure-next-auth.session-token'

function isChatGptOrigin(origin: string | undefined | null): boolean {
  return isChatGptUrl(origin ?? '')
}

export class ChatGptSession {
  private configured = false

  /** The one shared, persistent session. Same partition name on every launch and every version. */
  get session(): Session {
    return session.fromPartition(CHATGPT_PARTITION)
  }

  get partition(): string {
    return CHATGPT_PARTITION
  }

  configure(): void {
    if (this.configured) return
    this.configured = true
    const ses = this.session

    const userAgent = toChromeUserAgent(ses.getUserAgent())
    ses.setUserAgent(userAgent)
    app.userAgentFallback = userAgent

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const origin = details.requestingUrl || webContents?.getURL()
      const allowed = ALLOWED_PERMISSIONS.has(permission) && isChatGptOrigin(origin)
      if (!allowed) log.debug(`denied permission "${permission}" for ${redactUrl(origin)}`)
      callback(allowed)
    })

    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      return ALLOWED_PERMISSIONS.has(permission) && isChatGptOrigin(requestingOrigin)
    })

    ses.on('will-download', (_event, item) => {
      const filename = item.getFilename() || 'download'
      item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), filename) })
      item.once('done', (_doneEvent, state) => {
        log.info(`download ${state}`)
        if (state === 'completed' && process.platform === 'darwin') {
          app.dock?.downloadFinished(item.getSavePath())
        }
      })
    })

    log.info(`configured persistent partition ${CHATGPT_PARTITION}`)
  }

  /**
   * Whether ChatGPT session cookies exist. Only the presence of the cookie is checked; values are
   * never read out, stored or logged.
   */
  async isSignedIn(): Promise<boolean> {
    try {
      const cookies = await this.session.cookies.get({ url: 'https://chatgpt.com' })
      return cookies.some((cookie) => cookie.name.startsWith(SESSION_COOKIE_PREFIX))
    } catch (error) {
      log.error('cookie lookup failed', error)
      return false
    }
  }

  /** Removes cookies, storage, cache and HTTP auth data of the ChatGPT partition (= logout). */
  async clear(): Promise<void> {
    const ses = this.session
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearAuthCache()
    await ses.cookies.flushStore()
    log.info('session data cleared')
  }

  /** Persist pending cookie writes; called on quit so the login survives restarts. */
  async flush(): Promise<void> {
    try {
      this.session.flushStorageData()
      await this.session.cookies.flushStore()
    } catch (error) {
      log.error('flush failed', error)
    }
  }
}

export function isSignInLandingUrl(raw: string): boolean {
  const url = parseUrl(raw)
  if (!url || !isChatGptUrl(url)) return false
  return !url.pathname.startsWith('/auth') && !url.pathname.startsWith('/api/auth')
}

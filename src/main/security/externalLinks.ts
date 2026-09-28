import { shell } from 'electron'
import { createLogger } from '../logger'
import { isSafeExternalUrl, redactUrl } from './navigationPolicy'

const log = createLogger('external')

/** Opens a URL in the OS default browser/mail client. Only http(s) and mailto are ever passed on. */
export function openExternalSafely(url: string): void {
  if (!isSafeExternalUrl(url)) {
    log.warn(`refused to open external url with unsupported scheme`)
    return
  }
  log.info(`opening in system browser: ${redactUrl(url)}`)
  shell.openExternal(url).catch((error: unknown) => log.error('openExternal failed', error))
}

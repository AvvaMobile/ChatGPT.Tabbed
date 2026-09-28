import { app } from 'electron'

/**
 * Tiny console logger. Debug/info output is only produced in development.
 * Never pass cookies, tokens, credentials or full URLs (use `redactUrl`) to it.
 */
const verbose = !app.isPackaged || process.env.CHATGPT_TABS_DEBUG === '1'

function format(scope: string, message: string): string {
  return `[chatgpt-tabs:${scope}] ${message}`
}

export function createLogger(scope: string) {
  return {
    debug(message: string): void {
      if (verbose) console.debug(format(scope, message))
    },
    info(message: string): void {
      if (verbose) console.info(format(scope, message))
    },
    warn(message: string): void {
      console.warn(format(scope, message))
    },
    error(message: string, error?: unknown): void {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      console.error(format(scope, `${message}${detail}`))
    }
  }
}

export type Logger = ReturnType<typeof createLogger>

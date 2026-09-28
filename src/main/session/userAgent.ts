const KEPT_PRODUCTS = new Set(['Mozilla', 'AppleWebKit', 'Chrome', 'Safari', 'Version', 'Mobile'])

/**
 * Turns Electron's default user agent into the plain Chrome user agent of the bundled Chromium
 * by dropping the `Electron/x` and `<app-name>/x` product tokens.
 *
 * Google (and some other identity providers) refuse sign-in from user agents that advertise an
 * embedded Electron shell. The engine *is* Chromium, so this is the minimal change needed for the
 * standard login flows to work; no other identity is spoofed.
 */
export function toChromeUserAgent(userAgent: string): string {
  const tokens = userAgent.match(/\([^)]*\)|[^\s()]+/g) ?? []
  return tokens
    .filter((token) => {
      if (token.startsWith('(')) return true
      const slash = token.indexOf('/')
      if (slash === -1) return true
      return KEPT_PRODUCTS.has(token.slice(0, slash))
    })
    .join(' ')
}

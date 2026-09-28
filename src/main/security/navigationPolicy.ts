/**
 * Pure navigation policy for ChatGPT web contents. No Electron imports so it can be unit tested.
 *
 * Model:
 *  - ChatGPT hosts always stay inside the app.
 *  - Hosts needed for sign-in (OpenAI auth, Google, Microsoft, Apple, Cloudflare challenge) and
 *    checkout stay inside the app so the normal login/upgrade flows work.
 *  - While a page is already on a sign-in host, any https navigation is allowed so enterprise SSO
 *    identity providers (Okta, Entra, ...) keep working.
 *  - Every other http(s)/mailto link is handed to the operating system browser.
 *  - Everything else (file:, javascript:, custom schemes, ...) is denied.
 */

export type NavigationDecision = 'allow' | 'external' | 'deny'

/** What to do with a `window.open` / `target=_blank` request. */
export type WindowOpenDecision = 'new-tab' | 'popup' | 'external' | 'deny'

/** Where the navigation originates. */
export type NavigationContext = 'tab' | 'popup' | 'login'

const CHATGPT_HOSTS = ['chatgpt.com', 'chat.openai.com']

const AUTH_HOSTS = [
  // OpenAI
  'auth.openai.com',
  'auth0.openai.com',
  'pay.openai.com',
  // Google
  'accounts.google.com',
  'accounts.youtube.com',
  // Microsoft
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'account.live.com',
  // Apple
  'appleid.apple.com',
  'idmsa.apple.com',
  // Bot protection / checkout used inside the ChatGPT flows
  'challenges.cloudflare.com',
  'checkout.stripe.com'
]

function hostMatches(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function parseUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

export function isChatGptUrl(raw: string | URL | null | undefined): boolean {
  const url = typeof raw === 'string' || raw == null ? parseUrl(raw) : raw
  return !!url && url.protocol === 'https:' && hostMatches(url.hostname, CHATGPT_HOSTS)
}

export function isAuthUrl(raw: string | URL | null | undefined): boolean {
  const url = typeof raw === 'string' || raw == null ? parseUrl(raw) : raw
  return !!url && url.protocol === 'https:' && hostMatches(url.hostname, AUTH_HOSTS)
}

/** Only these schemes may ever be passed to `shell.openExternal`. */
export function isSafeExternalUrl(raw: string | null | undefined): boolean {
  const url = parseUrl(raw)
  if (!url) return false
  if (url.protocol === 'mailto:') return true
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
}

function isBlank(raw: string | null | undefined): boolean {
  return !raw || raw === 'about:blank'
}

export interface NavigationRequest {
  targetUrl: string
  /** URL currently committed in the navigating web contents. */
  currentUrl: string
  context: NavigationContext
}

export function decideNavigation({ targetUrl, currentUrl, context }: NavigationRequest): NavigationDecision {
  const target = parseUrl(targetUrl)
  if (!target) return 'deny'

  if (target.protocol === 'about:') return target.href === 'about:blank' ? 'allow' : 'deny'

  if (target.protocol !== 'https:') {
    return isSafeExternalUrl(targetUrl) ? 'external' : 'deny'
  }

  if (isChatGptUrl(target) || isAuthUrl(target)) return 'allow'

  // Mid sign-in (e.g. auth.openai.com -> company SSO): keep the whole flow in-app.
  if (context === 'login' || isAuthUrl(currentUrl)) return 'allow'

  return 'external'
}

export interface WindowOpenRequest {
  url: string
  context: NavigationContext
}

export function decideWindowOpen({ url, context }: WindowOpenRequest): WindowOpenDecision {
  // Blank popups are how many OAuth providers bootstrap their sign-in window.
  if (isBlank(url)) return 'popup'

  const target = parseUrl(url)
  if (!target) return 'deny'

  if (target.protocol === 'blob:') {
    const inner = parseUrl(target.pathname)
    return inner && isChatGptUrl(inner) ? 'popup' : 'deny'
  }

  if (isChatGptUrl(target)) return context === 'tab' ? 'new-tab' : 'popup'
  if (isAuthUrl(target)) return 'popup'
  if (isSafeExternalUrl(url)) return 'external'
  return 'deny'
}

/**
 * Removes query string, fragment and credentials so URLs can be shown in the UI or logged
 * without leaking OAuth codes, tokens or other sensitive parameters.
 */
export function redactUrl(raw: string | null | undefined): string {
  const url = parseUrl(raw)
  if (!url) return ''
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${url.protocol}`
  return `${url.origin}${url.pathname}`
}

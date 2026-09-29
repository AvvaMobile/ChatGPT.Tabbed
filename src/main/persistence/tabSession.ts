import { MAX_TAB_NAME_LENGTH, MAX_TABS } from '@shared/constants'
import { cleanTitle } from '@shared/validation'
import { isChatGptUrl, parseUrl } from '../security/navigationPolicy'

/**
 * Saved tab layout used to reopen tabs on the next launch. Pure functions only (unit-tested);
 * file IO lives in jsonFile.ts.
 *
 * Only what is needed to reopen a tab is kept: the ChatGPT page (origin + path, never query
 * strings, fragments or sign-in URLs), the page title and the optional custom name.
 */

export const TAB_SESSION_VERSION = 1
const MAX_PAGE_TITLE_LENGTH = 200

export interface SavedTab {
  url: string
  title: string
  customTitle: string | null
}

export interface SavedSplit {
  left: number
  right: number
}

export interface SavedTabSession {
  version: typeof TAB_SESSION_VERSION
  activeIndex: number
  tabs: SavedTab[]
  /** Tab indexes shown side by side, or null when split view was off. */
  split: SavedSplit | null
}

/** A ChatGPT URL that is safe and useful to reopen, or null. */
export function restorableUrl(raw: string | null | undefined): string | null {
  const url = parseUrl(raw)
  if (!url || !isChatGptUrl(url)) return null
  const path = url.pathname
  if (path.startsWith('/auth') || path.startsWith('/api')) return null
  return `${url.origin}${path}`
}

export function sanitizeSavedTab(value: unknown): SavedTab | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const url = typeof record.url === 'string' ? restorableUrl(record.url) : null
  if (!url) return null
  const title = typeof record.title === 'string' ? cleanTitle(record.title, MAX_PAGE_TITLE_LENGTH) : ''
  const custom = typeof record.customTitle === 'string' ? cleanTitle(record.customTitle, MAX_TAB_NAME_LENGTH) : ''
  return { url, title, customTitle: custom || null }
}

/** Validates data read from disk; anything unexpected is dropped rather than trusted. */
export function parseTabSession(value: unknown): SavedTabSession | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== TAB_SESSION_VERSION || !Array.isArray(record.tabs)) return null
  const tabs = record.tabs
    .slice(0, MAX_TABS)
    .map(sanitizeSavedTab)
    .filter((tab): tab is SavedTab => tab !== null)
  if (tabs.length === 0) return null
  const rawIndex = typeof record.activeIndex === 'number' && Number.isInteger(record.activeIndex) ? record.activeIndex : 0
  let activeIndex = Math.min(Math.max(rawIndex, 0), tabs.length - 1)
  const split = parseSplit(record.split, tabs.length)
  if (split && activeIndex !== split.left && activeIndex !== split.right) activeIndex = split.left
  return { version: TAB_SESSION_VERSION, activeIndex, tabs, split }
}

function parseSplit(value: unknown, count: number): SavedSplit | null {
  if (!value || typeof value !== 'object') return null
  const { left, right } = value as Record<string, unknown>
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count
  return valid(left) && valid(right) && left !== right ? { left, right } : null
}

export function buildTabSession(tabs: SavedTab[], activeIndex: number, split: SavedSplit | null = null): SavedTabSession {
  return parseTabSession({ version: TAB_SESSION_VERSION, activeIndex, tabs, split }) ?? {
    version: TAB_SESSION_VERSION,
    activeIndex: 0,
    tabs: [],
    split: null
  }
}

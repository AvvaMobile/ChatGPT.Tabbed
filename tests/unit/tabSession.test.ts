import { describe, expect, it } from 'vitest'
import { MAX_TABS } from '../../src/shared/constants'
import { cleanTitle } from '../../src/shared/validation'
import { buildTabSession, parseTabSession, restorableUrl } from '../../src/main/persistence/tabSession'

describe('restorableUrl', () => {
  it('keeps ChatGPT pages without query strings or fragments', () => {
    expect(restorableUrl('https://chatgpt.com/c/abc-123?model=x#y')).toBe('https://chatgpt.com/c/abc-123')
    expect(restorableUrl('https://chatgpt.com/')).toBe('https://chatgpt.com/')
  })

  it('never stores sign-in, API or foreign URLs', () => {
    expect(restorableUrl('https://chatgpt.com/auth/login?code=SECRET')).toBeNull()
    expect(restorableUrl('https://chatgpt.com/api/auth/callback')).toBeNull()
    expect(restorableUrl('https://auth.openai.com/log-in')).toBeNull()
    expect(restorableUrl('https://example.com/c/1')).toBeNull()
    expect(restorableUrl('file:///etc/passwd')).toBeNull()
    expect(restorableUrl('')).toBeNull()
  })
})

describe('parseTabSession', () => {
  it('accepts a valid session', () => {
    const session = parseTabSession({
      version: 1,
      activeIndex: 1,
      tabs: [
        { url: 'https://chatgpt.com/', title: 'ChatGPT', customTitle: null },
        { url: 'https://chatgpt.com/c/1', title: 'Trip', customTitle: 'Lisbon' }
      ]
    })
    expect(session?.activeIndex).toBe(1)
    expect(session?.tabs[1]).toEqual({ url: 'https://chatgpt.com/c/1', title: 'Trip', customTitle: 'Lisbon' })
  })

  it('drops invalid entries and clamps the active index', () => {
    const session = parseTabSession({
      version: 1,
      activeIndex: 9,
      tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://chatgpt.com/c/2', title: 42, customTitle: '  ' }, null]
    })
    expect(session).toEqual({
      version: 1,
      activeIndex: 0,
      tabs: [{ url: 'https://chatgpt.com/c/2', title: '', customTitle: null }],
      split: null
    })
  })

  it('rejects garbage, unknown versions and empty sessions', () => {
    expect(parseTabSession(null)).toBeNull()
    expect(parseTabSession('tabs')).toBeNull()
    expect(parseTabSession({ version: 2, activeIndex: 0, tabs: [{ url: 'https://chatgpt.com/' }] })).toBeNull()
    expect(parseTabSession({ version: 1, activeIndex: 0, tabs: [] })).toBeNull()
  })

  it('keeps a valid split and makes the active tab one of its panes', () => {
    const tabs = [0, 1, 2].map((i) => ({ url: `https://chatgpt.com/c/${i}` }))
    expect(parseTabSession({ version: 1, activeIndex: 2, tabs, split: { left: 0, right: 2 } })).toMatchObject({
      activeIndex: 2,
      split: { left: 0, right: 2 }
    })
    expect(parseTabSession({ version: 1, activeIndex: 1, tabs, split: { left: 0, right: 2 } })?.activeIndex).toBe(0)
  })

  it('drops invalid splits', () => {
    const tabs = [0, 1].map((i) => ({ url: `https://chatgpt.com/c/${i}` }))
    for (const split of [{ left: 0, right: 0 }, { left: 0, right: 5 }, { left: -1, right: 1 }, { left: '0', right: 1 }, 'yes']) {
      expect(parseTabSession({ version: 1, activeIndex: 0, tabs, split })?.split).toBeNull()
    }
  })

  it('limits the number of tabs', () => {
    const tabs = Array.from({ length: MAX_TABS + 10 }, (_, i) => ({ url: `https://chatgpt.com/c/${i}` }))
    expect(parseTabSession({ version: 1, activeIndex: 0, tabs })?.tabs).toHaveLength(MAX_TABS)
  })

  it('cleans names', () => {
    const session = buildTabSession([{ url: 'https://chatgpt.com/', title: 'a\u0000b', customTitle: 'x'.repeat(500) }], 0)
    expect(session.tabs[0].title).toBe('a b')
    expect(session.tabs[0].customTitle).toHaveLength(80)
  })
})

describe('cleanTitle', () => {
  it('collapses whitespace and strips control characters', () => {
    expect(cleanTitle('  Trip\\n to\\tLisbon\u0007 ', 50)).toBe('Trip\\n to\\tLisbon')
    expect(cleanTitle('line\nbreak\ttab', 50)).toBe('line break tab')
    expect(cleanTitle('abcdef', 3)).toBe('abc')
  })
})

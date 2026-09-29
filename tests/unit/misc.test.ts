import { describe, expect, it } from 'vitest'
import { CHATGPT_PARTITION, TOP_BAR_HEIGHT } from '../../src/shared/constants'
import { isTabId } from '../../src/shared/validation'
import { toChromeUserAgent } from '../../src/main/session/userAgent'
import { computeSplitBounds, computeTabViewBounds } from '../../src/main/window/layout'
import { adjacentTabId, pickNextActiveTab, tabIdForShortcut } from '../../src/main/tabs/tabOrder'

describe('constants', () => {
  it('uses the fixed persistent partition', () => {
    expect(CHATGPT_PARTITION).toBe('persist:chatgpt')
  })
})

describe('isTabId', () => {
  it('accepts only well-formed ids', () => {
    expect(isTabId('tab-1')).toBe(true)
    expect(isTabId('tab-42')).toBe(true)
    expect(isTabId('tab-0')).toBe(false)
    expect(isTabId('tab-1; rm -rf /')).toBe(false)
    expect(isTabId(1)).toBe(false)
    expect(isTabId({ id: 'tab-1' })).toBe(false)
    expect(isTabId(undefined)).toBe(false)
  })
})

describe('toChromeUserAgent', () => {
  it('drops Electron and app tokens, keeps Chrome identity', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) chatgpt-tabs-desktop/1.0.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36'
    expect(toChromeUserAgent(ua)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
    )
  })

  it('is idempotent on a plain Chrome UA', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
    expect(toChromeUserAgent(chrome)).toBe(chrome)
  })
})

describe('computeTabViewBounds', () => {
  it('fills the window below the top bar', () => {
    expect(computeTabViewBounds({ width: 1280, height: 860 })).toEqual({ x: 0, y: TOP_BAR_HEIGHT, width: 1280, height: 860 - TOP_BAR_HEIGHT })
  })

  it('never produces negative sizes', () => {
    expect(computeTabViewBounds({ width: -5, height: 10 })).toEqual({ x: 0, y: TOP_BAR_HEIGHT, width: 0, height: 0 })
  })

  it('floors fractional sizes', () => {
    expect(computeTabViewBounds({ width: 800.7, height: 600.9 }, 40)).toEqual({ x: 0, y: 40, width: 800, height: 560 })
  })
})

describe('computeSplitBounds', () => {
  it('splits the content area into two columns with a 1px gap', () => {
    const { left, right } = computeSplitBounds({ width: 1281, height: 860 })
    expect(left).toEqual({ x: 0, y: TOP_BAR_HEIGHT, width: 640, height: 860 - TOP_BAR_HEIGHT })
    expect(right).toEqual({ x: 641, y: TOP_BAR_HEIGHT, width: 640, height: 860 - TOP_BAR_HEIGHT })
  })

  it('covers the full width without overlap for odd and even sizes', () => {
    for (const width of [640, 641, 1000, 1439]) {
      const { left, right } = computeSplitBounds({ width, height: 700 })
      expect(left.width + 1 + right.width).toBe(width)
      expect(right.x).toBe(left.width + 1)
    }
  })
})

describe('tab order helpers', () => {
  const order = ['tab-1', 'tab-2', 'tab-3']

  it('activates the right neighbour, then the left one after closing', () => {
    expect(pickNextActiveTab(order, 'tab-2')).toBe('tab-3')
    expect(pickNextActiveTab(order, 'tab-3')).toBe('tab-2')
    expect(pickNextActiveTab(['tab-1'], 'tab-1')).toBeNull()
  })

  it('maps Cmd/Ctrl+digit to tabs, 9 = last', () => {
    expect(tabIdForShortcut(order, 1)).toBe('tab-1')
    expect(tabIdForShortcut(order, 3)).toBe('tab-3')
    expect(tabIdForShortcut(order, 5)).toBeNull()
    expect(tabIdForShortcut(order, 9)).toBe('tab-3')
    expect(tabIdForShortcut(order, 0)).toBeNull()
  })

  it('cycles through tabs', () => {
    expect(adjacentTabId(order, 'tab-3', 1)).toBe('tab-1')
    expect(adjacentTabId(order, 'tab-1', -1)).toBe('tab-3')
    expect(adjacentTabId([], null, 1)).toBeNull()
  })
})

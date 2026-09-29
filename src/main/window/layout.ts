import { TOP_BAR_HEIGHT } from '@shared/constants'

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Single source of truth for where the active ChatGPT view goes inside the window.
 * Input and output are in DIPs (Electron converts to device pixels, so Retina/HiDPI is handled).
 */
export function computeTabViewBounds(contentSize: Size, topBarHeight: number = TOP_BAR_HEIGHT): Rect {
  const width = Math.max(0, Math.floor(contentSize.width))
  const height = Math.max(0, Math.floor(contentSize.height) - topBarHeight)
  return { x: 0, y: topBarHeight, width, height }
}

/** Width of the gap between the two panes of the split view (the renderer draws the divider). */
export const SPLIT_DIVIDER = 6

/** Left and right pane bounds for the two-column split view. */
export function computeSplitBounds(
  contentSize: Size,
  topBarHeight: number = TOP_BAR_HEIGHT,
  divider: number = SPLIT_DIVIDER
): { left: Rect; right: Rect } {
  const full = computeTabViewBounds(contentSize, topBarHeight)
  const leftWidth = Math.max(0, Math.floor((full.width - divider) / 2))
  const rightX = leftWidth + divider
  return {
    left: { x: 0, y: full.y, width: leftWidth, height: full.height },
    right: { x: rightX, y: full.y, width: Math.max(0, full.width - rightX), height: full.height }
  }
}

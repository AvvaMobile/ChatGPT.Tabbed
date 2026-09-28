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

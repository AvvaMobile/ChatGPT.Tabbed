/** Chrome-like choice of the tab to activate after `closingId` is closed: right neighbour, else left. */
export function pickNextActiveTab(order: readonly string[], closingId: string): string | null {
  const index = order.indexOf(closingId)
  if (index === -1) return order[0] ?? null
  return order[index + 1] ?? order[index - 1] ?? null
}

/** Cmd/Ctrl+1..8 select that tab; Cmd/Ctrl+9 selects the last tab (Chrome behaviour). */
export function tabIdForShortcut(order: readonly string[], digit: number): string | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9 || order.length === 0) return null
  if (digit === 9) return order[order.length - 1]
  return order[digit - 1] ?? null
}

/** Neighbouring tab for Ctrl+Tab / Ctrl+Shift+Tab, wrapping around. */
export function adjacentTabId(order: readonly string[], currentId: string | null, delta: 1 | -1): string | null {
  if (order.length === 0) return null
  const index = currentId ? order.indexOf(currentId) : -1
  if (index === -1) return order[0]
  return order[(index + delta + order.length) % order.length]
}

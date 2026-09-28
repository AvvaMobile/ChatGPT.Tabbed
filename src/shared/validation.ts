const TAB_ID_PATTERN = /^tab-[1-9][0-9]{0,8}$/

export function isTabId(value: unknown): value is string {
  return typeof value === 'string' && TAB_ID_PATTERN.test(value)
}

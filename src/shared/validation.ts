const TAB_ID_PATTERN = /^tab-[1-9][0-9]{0,8}$/

export function isTabId(value: unknown): value is string {
  return typeof value === 'string' && TAB_ID_PATTERN.test(value)
}

/** Removes control characters and collapses whitespace in user-provided or page titles. */
export function cleanTitle(value: string, maxLength: number): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

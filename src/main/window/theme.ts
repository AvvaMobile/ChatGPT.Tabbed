import { nativeTheme } from 'electron'

/** Colours shared with the renderer CSS (src/renderer/src/styles.css). */
const palette = {
  light: { bar: '#eceef1', barSymbol: '#1f2328', content: '#ffffff' },
  dark: { bar: '#171717', barSymbol: '#e6e6e6', content: '#212121' }
} as const

export function currentPalette() {
  return nativeTheme.shouldUseDarkColors ? palette.dark : palette.light
}

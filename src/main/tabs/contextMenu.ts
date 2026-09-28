import { app, clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { openExternalSafely } from '../security/externalLinks'
import { isChatGptUrl, isSafeExternalUrl } from '../security/navigationPolicy'

/**
 * Native right-click menu (Electron shows none by default). Built purely from the
 * `context-menu` event parameters; no DOM access.
 */
export function attachContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    const { editFlags } = params

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => webContents.replaceMisspelling(suggestion) })
      }
      items.push({
        label: 'Add to Dictionary',
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      items.push({ type: 'separator' })
    }

    if (params.linkURL && isSafeExternalUrl(params.linkURL)) {
      if (!isChatGptUrl(params.linkURL)) {
        items.push({ label: 'Open Link in Browser', click: () => openExternalSafely(params.linkURL) })
      }
      items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) })
      items.push({ type: 'separator' })
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: 'Copy Image', click: () => webContents.copyImageAt(params.x, params.y) })
      items.push({ label: 'Save Image As…', click: () => webContents.downloadURL(params.srcURL) })
      items.push({ type: 'separator' })
    }

    if (params.isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: editFlags.canPaste },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }

    if (!app.isPackaged) {
      items.push(
        { type: 'separator' },
        { label: 'Inspect Element', click: () => webContents.inspectElement(params.x, params.y) }
      )
    }

    while (items.length > 0 && items[items.length - 1].type === 'separator') items.pop()
    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup()
  })
}

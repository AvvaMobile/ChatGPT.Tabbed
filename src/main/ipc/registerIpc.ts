import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel } from '@shared/ipc'
import { MAX_TAB_NAME_LENGTH } from '@shared/constants'
import { isTabId } from '@shared/validation'
import type { AppController } from '../AppController'
import { createLogger } from '../logger'
import { isShellUrl } from '../window/mainWindow'

const log = createLogger('ipc')

/**
 * Only the app's own shell UI (main frame of the main window) may call these handlers.
 * The remote ChatGPT web contents have no preload and therefore no IPC access at all; this check
 * is a second line of defence.
 */
function assertTrustedSender(controller: AppController, event: IpcMainInvokeEvent): void {
  const win = controller.mainWindow
  const frame = event.senderFrame
  const trusted =
    !!win &&
    event.sender === win.webContents &&
    !!frame &&
    frame === event.sender.mainFrame &&
    isShellUrl(frame.url)
  if (!trusted) {
    log.warn('rejected IPC call from untrusted sender')
    throw new Error('Unauthorized IPC sender')
  }
}

function requireTabId(value: unknown): string {
  if (!isTabId(value)) throw new Error('Invalid tab id')
  return value
}

export function registerIpc(controller: AppController): void {
  const handle = <T>(channel: string, handler: (...args: unknown[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedSender(controller, event)
      return handler(...args)
    })
  }

  handle(IpcChannel.GetState, () => controller.getState())
  handle(IpcChannel.GetInfo, () => controller.getInfo())
  handle(IpcChannel.CreateTab, () => controller.newTab())
  handle(IpcChannel.ActivateTab, (id) => controller.activateTab(requireTabId(id)))
  handle(IpcChannel.CloseTab, (id) => controller.closeTab(requireTabId(id)))
  handle(IpcChannel.ReloadTab, (id) => {
    if (id === undefined || id === null) controller.reloadActiveTab()
    else controller.reloadTab(requireTabId(id))
  })
  handle(IpcChannel.GoBack, () => controller.goBack())
  handle(IpcChannel.GoForward, () => controller.goForward())
  handle(IpcChannel.OpenSettings, () => controller.setSettingsOpen(true))
  handle(IpcChannel.CloseSettings, () => controller.setSettingsOpen(false))
  handle(IpcChannel.OpenLogin, () => controller.openLogin())
  handle(IpcChannel.GetAuthStatus, async () => ({ signedIn: await controller.isSignedIn() }))
  handle(IpcChannel.ClearSession, () => controller.clearSession())
  handle(IpcChannel.RenameTab, (id, name) => {
    if (name !== null && (typeof name !== 'string' || name.length > MAX_TAB_NAME_LENGTH * 4)) {
      throw new Error('Invalid tab name')
    }
    controller.renameTab(requireTabId(id), name)
  })
  handle(IpcChannel.ShowTabMenu, (id) => controller.showTabMenu(requireTabId(id)))
  handle(IpcChannel.GetSettings, () => controller.getSettings())
  handle(IpcChannel.SetSettings, (patch) => controller.updateSettings(patch))
}

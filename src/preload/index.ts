import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type AppState, type RendererApi } from '@shared/ipc'

/**
 * Minimal, typed bridge for the local shell UI only. ChatGPT web contents never load this script.
 * No generic invoke/send is exposed; every call maps to one fixed channel.
 */
const api: RendererApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke(IpcChannel.GetState),
  getInfo: () => ipcRenderer.invoke(IpcChannel.GetInfo),
  onStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppState): void => listener(state)
    ipcRenderer.on(IpcChannel.StateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.StateChanged, handler)
    }
  },
  createTab: () => ipcRenderer.invoke(IpcChannel.CreateTab),
  activateTab: (id) => ipcRenderer.invoke(IpcChannel.ActivateTab, id),
  closeTab: (id) => ipcRenderer.invoke(IpcChannel.CloseTab, id),
  reloadTab: (id) => ipcRenderer.invoke(IpcChannel.ReloadTab, id),
  goBack: () => ipcRenderer.invoke(IpcChannel.GoBack),
  goForward: () => ipcRenderer.invoke(IpcChannel.GoForward),
  openSettings: () => ipcRenderer.invoke(IpcChannel.OpenSettings),
  closeSettings: () => ipcRenderer.invoke(IpcChannel.CloseSettings),
  openLogin: () => ipcRenderer.invoke(IpcChannel.OpenLogin),
  getAuthStatus: () => ipcRenderer.invoke(IpcChannel.GetAuthStatus),
  clearSession: () => ipcRenderer.invoke(IpcChannel.ClearSession),
  renameTab: (id, name) => ipcRenderer.invoke(IpcChannel.RenameTab, id, name),
  showTabMenu: (id) => ipcRenderer.invoke(IpcChannel.ShowTabMenu, id),
  onBeginRename: (listener) => {
    const handler = (_event: IpcRendererEvent, id: string): void => listener(id)
    ipcRenderer.on(IpcChannel.BeginRename, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.BeginRename, handler)
    }
  },
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  setSettings: (patch) => ipcRenderer.invoke(IpcChannel.SetSettings, patch)
}

contextBridge.exposeInMainWorld('chatgptTabs', api)

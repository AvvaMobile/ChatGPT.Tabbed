import { app } from 'electron'
import { join } from 'node:path'
import type { AppSettings } from '@shared/ipc'
import { readJson, writeJson } from './jsonFile'

const DEFAULT_SETTINGS: AppSettings = { restoreTabs: true }

/** App preferences in <userData>/settings.json. Never contains credentials or cookies. */
export class SettingsStore {
  private readonly path = join(app.getPath('userData'), 'settings.json')
  private current: AppSettings

  constructor() {
    const stored = readJson(this.path)
    const record = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
    this.current = {
      restoreTabs: typeof record.restoreTabs === 'boolean' ? record.restoreTabs : DEFAULT_SETTINGS.restoreTabs
    }
  }

  get(): AppSettings {
    return { ...this.current }
  }

  update(patch: unknown): AppSettings {
    const record = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
    if (typeof record.restoreTabs === 'boolean') this.current.restoreTabs = record.restoreTabs
    writeJson(this.path, this.current)
    return this.get()
  }
}

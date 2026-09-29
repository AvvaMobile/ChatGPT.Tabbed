import { app } from 'electron'
import { join } from 'node:path'
import { readJson, removeFile, writeJson } from './jsonFile'
import { parseTabSession, type SavedTabSession } from './tabSession'

const SAVE_DELAY_MS = 1000

/** Persists the open tabs to <userData>/tabs.json (user-only permissions), debounced. */
export class TabSessionStore {
  private readonly path = join(app.getPath('userData'), 'tabs.json')
  private timer: NodeJS.Timeout | null = null
  private pending: (() => SavedTabSession) | null = null
  private lastWritten = ''

  load(): SavedTabSession | null {
    return parseTabSession(readJson(this.path))
  }

  /** Schedules a save; `snapshot` is evaluated when the write actually happens. */
  schedule(snapshot: () => SavedTabSession): void {
    this.pending = snapshot
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS)
  }

  /** Writes immediately (used on window close and quit). */
  saveNow(session: SavedTabSession): void {
    this.cancel()
    this.write(session)
  }

  flush(): void {
    const snapshot = this.pending
    this.cancel()
    if (snapshot) this.write(snapshot())
  }

  clear(): void {
    this.cancel()
    this.lastWritten = ''
    removeFile(this.path)
  }

  private write(session: SavedTabSession): void {
    if (session.tabs.length === 0) return
    const serialized = JSON.stringify(session)
    if (serialized === this.lastWritten) return
    this.lastWritten = serialized
    writeJson(this.path, session)
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}

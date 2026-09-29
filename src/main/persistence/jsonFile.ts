import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../logger'

const log = createLogger('storage')

/** Reads a JSON file; missing or corrupt files yield null. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`ignoring unreadable ${path}`)
    return null
  }
}

/** Atomic write (temp file + rename), readable by the current user only. */
export function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.tmp`
    writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, path)
  } catch (error) {
    log.error(`could not write ${path}`, error)
  }
}

export function removeFile(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    log.error(`could not remove ${path}`, error)
  }
}

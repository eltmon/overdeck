import { appendFileSync, existsSync, readFileSync } from 'fs'

import type { PanSessionEntry } from './types.js'
import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function appendSession(workspacePath: string, entry: PanSessionEntry): void {
  const { sessionsPath } = ensureWorkspacePanDir(workspacePath)
  appendFileSync(sessionsPath, `${JSON.stringify(entry)}\n`, 'utf-8')
}

export function readSessions(workspacePath: string): PanSessionEntry[] {
  const { sessionsPath } = getWorkspacePanPaths(workspacePath)
  if (!existsSync(sessionsPath)) return []
  const raw = readFileSync(sessionsPath, 'utf-8')
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as PanSessionEntry
      } catch (error) {
        throw new Error(`Invalid JSONL in ${sessionsPath} at line ${index + 1}: ${(error as Error).message}`)
      }
    })
}

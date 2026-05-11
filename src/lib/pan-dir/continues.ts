import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join, basename } from 'path'

import { ensurePanDirs } from './specs.js'

export function getContinuesDir(projectRoot: string): string {
  return join(projectRoot, '.pan', 'continues')
}

export function getContinueFilePath(projectRoot: string, issueId: string): string {
  return join(getContinuesDir(projectRoot), `${issueId.toLowerCase()}.vbrief.json`)
}

export function hasContinueFile(projectRoot: string, issueId: string): boolean {
  return existsSync(getContinueFilePath(projectRoot, issueId))
}

export function readContinueFile(projectRoot: string, issueId: string): string | null {
  const path = getContinueFilePath(projectRoot, issueId)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function writeContinueFile(projectRoot: string, issueId: string, content: string): string {
  ensurePanDirs(projectRoot)
  const path = getContinueFilePath(projectRoot, issueId)
  writeFileSync(path, content, 'utf-8')
  return path
}

export function listContinueFiles(projectRoot: string): string[] {
  const continuesDir = getContinuesDir(projectRoot)
  if (!existsSync(continuesDir)) return []
  return readdirSync(continuesDir)
    .filter(filename => filename.endsWith('.vbrief.json'))
    .map(filename => basename(filename, '.vbrief.json'))
}

export function deleteContinueFile(projectRoot: string, issueId: string): boolean {
  const path = getContinueFilePath(projectRoot, issueId)
  if (!existsSync(path)) return false

  try {
    const deletedDir = join(getContinuesDir(projectRoot), 'deleted')
    mkdirSync(deletedDir, { recursive: true })
    renameSync(path, join(deletedDir, `${issueId.toLowerCase()}-${Date.now()}.vbrief.json`))
    return true
  } catch {
    return false
  }
}

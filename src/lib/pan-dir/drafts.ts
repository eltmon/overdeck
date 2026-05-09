import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { join, basename } from 'path'

import { getProjectPanPaths, ensurePanDirs } from './specs.js'

export function getDraftsDir(projectRoot: string): string {
  return getProjectPanPaths(projectRoot).draftsDir
}

export function getDraftPath(projectRoot: string, filename: string): string {
  return join(getDraftsDir(projectRoot), filename)
}

export function getIssueDraftPath(projectRoot: string, issueId: string): string {
  return getDraftPath(projectRoot, `${issueId.toUpperCase()}.md`)
}

export function hasIssueDraft(projectRoot: string, issueId: string): boolean {
  return existsSync(getIssueDraftPath(projectRoot, issueId))
}

export function readIssueDraft(projectRoot: string, issueId: string): string | null {
  const path = getIssueDraftPath(projectRoot, issueId)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function writeIssueDraft(projectRoot: string, issueId: string, content: string): string {
  ensurePanDirs(projectRoot)
  const path = getIssueDraftPath(projectRoot, issueId)
  writeFileSync(path, content, 'utf-8')
  return path
}

export function listIssueDrafts(projectRoot: string): string[] {
  const draftsDir = getDraftsDir(projectRoot)
  if (!existsSync(draftsDir)) return []
  return readdirSync(draftsDir)
    .filter(filename => filename.endsWith('.md'))
    .map(filename => basename(filename, '.md'))
}

export function deleteIssueDraft(projectRoot: string, issueId: string): boolean {
  const path = getIssueDraftPath(projectRoot, issueId)
  if (!existsSync(path)) return false

  try {
    const deletedDir = join(getDraftsDir(projectRoot), 'deleted')
    mkdirSync(deletedDir, { recursive: true })
    renameSync(path, join(deletedDir, `${issueId.toUpperCase()}-${Date.now()}.md`))
    return true
  } catch {
    return false
  }
}

export function getIssueDraftInfo(projectRoot: string, issueId: string): {
  exists: boolean
  path?: string
  size?: number
  modified?: Date
} {
  const path = getIssueDraftPath(projectRoot, issueId)
  if (!existsSync(path)) {
    return { exists: false }
  }

  const stats = statSync(path)
  return {
    exists: true,
    path,
    size: stats.size,
    modified: stats.mtime,
  }
}

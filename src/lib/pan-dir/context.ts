import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function readWorkspaceContext(workspacePath: string): string | null {
  const { contextPath } = getWorkspacePanPaths(workspacePath)
  if (!existsSync(contextPath)) return null
  return readFileSync(contextPath, 'utf-8')
}

export function writeWorkspaceContext(workspacePath: string, content: string): string {
  const { contextPath } = ensureWorkspacePanDir(workspacePath)
  const tmp = `${contextPath}.tmp`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, contextPath)
  return contextPath
}

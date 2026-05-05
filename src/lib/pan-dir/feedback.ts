import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { PanFeedbackFile } from './types.js'
import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function readFeedback(workspacePath: string): PanFeedbackFile[] {
  const { feedbackDir } = getWorkspacePanPaths(workspacePath)
  if (!existsSync(feedbackDir)) return []

  return readdirSync(feedbackDir)
    .map(filename => {
      const path = join(feedbackDir, filename)
      return {
        path,
        filename,
        content: readFileSync(path, 'utf-8'),
      }
    })
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

export function writeFeedback(workspacePath: string, filename: string, content: string): string {
  const { feedbackDir } = ensureWorkspacePanDir(workspacePath)
  mkdirSync(feedbackDir, { recursive: true })
  const path = join(feedbackDir, filename)
  writeFileSync(path, content, 'utf-8')
  return path
}

export function clearFeedback(workspacePath: string): void {
  const { feedbackDir } = getWorkspacePanPaths(workspacePath)
  if (!existsSync(feedbackDir)) return
  for (const filename of readdirSync(feedbackDir)) {
    rmSync(join(feedbackDir, filename), { force: true })
  }
}

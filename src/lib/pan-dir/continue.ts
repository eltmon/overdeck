import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { WorkspaceContinueState, WorkspacePanPaths } from './types.js'
import {
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
  PAN_SPEC_FILENAME,
  PAN_CONTEXT_FILENAME,
} from './types.js'

function workspacePanPaths(workspacePath: string): WorkspacePanPaths {
  const panDir = join(workspacePath, PAN_DIRNAME)
  return {
    panDir,
    specPath: join(panDir, PAN_SPEC_FILENAME),
    continuePath: join(panDir, PAN_CONTINUE_FILENAME),
    sessionsPath: join(panDir, PAN_SESSIONS_FILENAME),
    feedbackDir: join(panDir, PAN_FEEDBACK_DIRNAME),
    contextPath: join(panDir, PAN_CONTEXT_FILENAME),
  }
}

export function getWorkspacePanPaths(workspacePath: string): WorkspacePanPaths {
  return workspacePanPaths(workspacePath)
}

export function ensureWorkspacePanDir(workspacePath: string): WorkspacePanPaths {
  const paths = workspacePanPaths(workspacePath)
  mkdirSync(paths.panDir, { recursive: true })
  mkdirSync(paths.feedbackDir, { recursive: true })
  return paths
}

function validateWorkspaceContinueState(value: unknown, path: string): asserts value is WorkspaceContinueState {
  if (!value || typeof value !== 'object') {
    throw new Error(`Continue file ${path} is not an object`)
  }
  const v = value as Record<string, unknown>
  if (v.version !== '1') {
    throw new Error(`Continue file ${path} has unsupported version: ${String(v.version)}`)
  }
  if (typeof v.issueId !== 'string') {
    throw new Error(`Continue file ${path} missing issueId`)
  }
  if (typeof v.created !== 'string' || typeof v.updated !== 'string') {
    throw new Error(`Continue file ${path} missing created/updated timestamps`)
  }
  if (!Array.isArray(v.decisions) || !Array.isArray(v.hazards) || !Array.isArray(v.sessionHistory)) {
    throw new Error(`Continue file ${path} has malformed array fields`)
  }
  if (typeof v.beadsMapping !== 'object' || v.beadsMapping === null) {
    throw new Error(`Continue file ${path} has malformed beadsMapping`)
  }
  if (v.feedback === undefined) {
    ;(v as Record<string, unknown>).feedback = []
  } else if (!Array.isArray(v.feedback)) {
    throw new Error(`Continue file ${path} has malformed feedback array`)
  }
}

export function readWorkspaceContinue(workspacePath: string): WorkspaceContinueState | null {
  const { continuePath } = workspacePanPaths(workspacePath)
  if (!existsSync(continuePath)) return null
  const raw = readFileSync(continuePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in continue file ${continuePath}: ${(error as Error).message}`)
  }
  validateWorkspaceContinueState(parsed, continuePath)
  return parsed
}

export function writeWorkspaceContinue(workspacePath: string, state: WorkspaceContinueState): WorkspaceContinueState {
  const { continuePath } = ensureWorkspacePanDir(workspacePath)
  const now = new Date().toISOString()
  const next: WorkspaceContinueState = {
    ...state,
    version: '1',
    created: state.created || now,
    updated: now,
  }
  const tmp = `${continuePath}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmp, continuePath)
  return next
}

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/types.js';

/**
 * PAN-4171: marks a worktree whose `createWorkspace` setup has not finished.
 *
 * `createWorkspace` writes it as soon as the worktree exists and removes it
 * when every setup step has run. A setup that aborts (dependency install,
 * pre-rebase hook, workspace package build) or a process that dies mid-setup
 * leaves it behind, so a retry resumes the setup instead of starting an agent
 * in a worktree with no dependencies, hooks or skills.
 *
 * It is an "incomplete" marker, not a "complete" one, so the workspaces that
 * existed before it (which carry no marker) are not all re-set-up on their
 * next start.
 */
export const WORKSPACE_SETUP_INCOMPLETE_FILENAME = 'setup-incomplete';

export function workspaceSetupMarkerPath(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_RUNTIME_DIRNAME, WORKSPACE_SETUP_INCOMPLETE_FILENAME);
}

export function markWorkspaceSetupIncomplete(workspacePath: string): void {
  mkdirSync(join(workspacePath, WORKSPACE_RUNTIME_DIRNAME), { recursive: true });
  writeFileSync(workspaceSetupMarkerPath(workspacePath), `${new Date().toISOString()}\n`, 'utf-8');
}

export function clearWorkspaceSetupIncomplete(workspacePath: string): void {
  rmSync(workspaceSetupMarkerPath(workspacePath), { force: true });
}

export function isWorkspaceSetupIncomplete(workspacePath: string): boolean {
  return existsSync(workspaceSetupMarkerPath(workspacePath));
}

/**
 * The one existence check every `createWorkspace` caller uses: true when the
 * workspace directory is missing or its setup never finished. Callers call
 * `createWorkspace` when this is true; `createWorkspace` resumes the setup of
 * an existing, unfinished worktree.
 */
export function workspaceNeedsSetup(workspacePath: string): boolean {
  return !existsSync(workspacePath) || isWorkspaceSetupIncomplete(workspacePath);
}

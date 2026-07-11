/**
 * Resolve the state-worktree key for a project (PAN-2372).
 *
 * An explicitly passed key wins; otherwise the registered projects.yaml key for
 * this path; otherwise the path basename as a fallback for unregistered
 * projects. This is the single source of truth for the registered-key lookup —
 * reused by both the async state-home door (`state-home.ts`) and the sync read
 * door (`resolveStateReadHomeSync` in `state-read-home.ts`) so they cannot
 * disagree on which state worktree a project lives in.
 *
 * It lives in its own module (rather than `state-home.ts`) so that importing it
 * from the lightweight sync-read door does not transitively pull
 * `child_process` / `state-plane` via the heavier `state-home` module — that
 * coupling previously broke tests that partially mock `child_process`. It
 * imports {@link listProjectsSync} from `projects.js`, so a `vi.mock` of
 * `projects.js` still steers the registry.
 */
import { basename, resolve } from 'node:path';
import { listProjectsSync, type ProjectConfig } from './projects.js';

export function projectKey(project: ProjectConfig, explicit?: string): string {
  if (explicit) return explicit;
  const projectPath = resolve(project.path);
  const match = listProjectsSync().find(({ config }) => resolve(config.path) === projectPath);
  return match?.key ?? basename(projectPath);
}

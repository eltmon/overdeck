/**
 * Issue workspace directory shapes (PAN-3887).
 *
 * One issue can own up to three on-disk shapes under `<project>/workspaces/`:
 * base (`feature-<id>`), strike (`feature-<id>-strike`), and swarm slots
 * (`feature-<id>-slot-<N>`). `pan workspace destroy` used to resolve only the
 * base shape, so finished strike workspaces were unreachable through the CLI.
 *
 * Pure filesystem helper — no store access, no tracker calls.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type IssueWorkspaceShape = 'base' | 'strike' | 'slot';

export interface IssueWorkspaceDir {
  /** Directory name, e.g. `feature-pan-2796-strike`. */
  name: string;
  /** Absolute path. */
  path: string;
  shape: IssueWorkspaceShape;
  /** Canonical branch for the shape (best-effort cleanup only). */
  branch: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exact slot names only: `<base>-slot-<integer>` (PAN-3694). Preserved
 * archives such as `feature-min-888-slot-1-reset-backup-20260814` share the
 * `-slot-` prefix but are operator-preserved state, never live slots.
 */
export function isSlotWorkspaceDirectoryName(baseName: string, entryName: string): boolean {
  return new RegExp(`^${escapeRegExp(baseName)}-slot-\\d+$`).test(entryName);
}

function pushIfExists(out: IssueWorkspaceDir[], workspacesDir: string, name: string, shape: IssueWorkspaceShape, branch: string): void {
  if (existsSync(join(workspacesDir, name))) {
    out.push({ name, path: join(workspacesDir, name), shape, branch });
  }
}

/**
 * Every existing workspace directory shape for an issue, in removal order
 * (slots, strike, base — base last so its worktree entry goes last).
 */
export function resolveIssueWorkspaceDirs(workspacesDir: string, issueLower: string): IssueWorkspaceDir[] {
  const out: IssueWorkspaceDir[] = [];
  const baseName = `feature-${issueLower}`;

  if (existsSync(workspacesDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(workspacesDir);
    } catch {
      entries = [];
    }
    for (const entry of entries.filter((name) => isSlotWorkspaceDirectoryName(baseName, name)).sort()) {
      const slotIndex = entry.slice(`${baseName}-slot-`.length);
      out.push({
        name: entry,
        path: join(workspacesDir, entry),
        shape: 'slot',
        branch: `feature/${issueLower}-slot-${slotIndex}`,
      });
    }
  }

  pushIfExists(out, workspacesDir, `${baseName}-strike`, 'strike', `strike/${issueLower}`);
  pushIfExists(out, workspacesDir, baseName, 'base', `feature/${issueLower}`);
  return out;
}

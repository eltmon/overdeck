/**
 * Issue → project / workspace resolution (PAN-3917 W9).
 *
 * These three helpers used to live in `src/lib/pan-dir/record.ts` alongside the
 * record plane, but they never touched a record: they are thin reads of
 * `projects.yaml`. The record plane is gone; the resolution stays.
 */

import { join } from 'node:path';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';

/** The registered project that owns an issue, or null when none does. */
export function resolveProjectForIssue(issueId: string): ProjectConfig | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return getProjectSync(resolved.projectKey);
}

/** `<project>/workspaces/feature-<issue>`, or null when no project owns the issue. */
export function getIssueWorkspacePath(issueId: string): string | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

/** A stand-in config for a workspace whose issue resolves to no registered project. */
export function getProjectConfigFromWorkspacePath(workspacePath: string): ProjectConfig {
  return { name: 'inferred', path: workspacePath };
}

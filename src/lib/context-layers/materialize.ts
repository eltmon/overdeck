/** Build one harness-correct, Overdeck-owned context artifact for a launch. */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Harness } from '@overdeck/contracts';

import { getOverdeckHome, isDevMode } from '../paths.js';
import { findProjectByPathSync } from '../projects.js';
import { workspaceContextWithoutProjectLayer } from './assemble.js';
import { renderForHarness } from './harness.js';
import { resolveWorkspaceContextFile } from './layers.js';
import { renderGlobalLayer, renderProjectLayer } from './render.js';

const SECTION_SEPARATOR = '\n\n---\n\n';

/**
 * Compose global rules, the current project's canonical layer, and the
 * workspace-only portion of a saved workspace bundle for the launch harness.
 *
 * Workspace bundles created before PAN-3779 may contain a project section
 * rendered for whichever harness created the worktree (historically Claude).
 * Strip that structural section and render the canonical project source for
 * the current harness instead. This prevents stale Claude-filtered context
 * from leaking into Codex, OMP, ACP, or Kimi launches and avoids delivering
 * the project layer twice.
 */
export function renderManagedLaunchContext(workspace: string, harness: Harness): string {
  const sections: string[] = [renderGlobalLayer(harness, isDevMode())];
  const project = findProjectByPathSync(workspace);
  if (project) sections.push(renderProjectLayer(project.path, harness));

  const workspaceFile = resolveWorkspaceContextFile(workspace);
  if (existsSync(workspaceFile)) {
    const saved = readFileSync(workspaceFile, 'utf8');
    const workspaceOnly = workspaceContextWithoutProjectLayer(saved);
    const body = renderForHarness(workspaceOnly, harness).trim();
    if (body) sections.push(`## Workspace context\n\nSource: ${workspaceFile}\n\n${body}`);
  }

  return sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join(SECTION_SEPARATOR)
    .trim();
}

/** Atomically materialize launch context at an explicitly Overdeck-owned path. */
export function materializeManagedLaunchContext(
  targetFile: string,
  workspace: string,
  harness: Harness,
): string {
  const content = renderManagedLaunchContext(workspace, harness);
  mkdirSync(dirname(targetFile), { recursive: true });
  const tmp = `${targetFile}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content.length > 0 ? `${content}\n` : '', { mode: 0o600 });
  renameSync(tmp, targetFile);
  return targetFile;
}

/**
 * Stable private artifact used by ordinary non-ACP launchers. The workspace
 * hash keeps paths short and avoids exposing project names in receipts.
 */
export function materializeSharedManagedLaunchContext(
  workspace: string,
  harness: Harness,
): string {
  const workspaceHash = createHash('sha256').update(resolve(workspace)).digest('hex').slice(0, 16);
  return materializeManagedLaunchContext(
    join(getOverdeckHome(), 'context', 'launch', `${harness}-${workspaceHash}.md`),
    workspace,
    harness,
  );
}

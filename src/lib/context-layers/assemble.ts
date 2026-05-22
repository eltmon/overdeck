/**
 * Workspace context assembly (PAN-1201).
 *
 * The workspace layer is not hand-authored — Panopticon assembles it when a
 * workspace is created, into `<workspace>/.pan/context/workspace.md`. It is a
 * single bundle composed, in order, of:
 *
 *   1. issue metadata (id, title, branch, phase)
 *   2. the parent project's layer, rendered for the workspace's harness
 *   3. injected memory (PAN-1052 MEMORY_CONTEXT), when available
 *   4. a live workspace status summary, when available
 *
 * The same content is written to the workspace's CLAUDE.md (so Claude Code
 * picks it up) and consumed harness-neutrally by the briefing system.
 */

import type { Harness } from '@panctl/contracts';
import { renderProjectLayer } from './render.js';

/** Inputs for {@link assembleWorkspaceContext}. */
export interface WorkspaceContextInput {
  /** Absolute path to the parent project's root. */
  projectRoot: string;
  /** Harness the workspace's agent runs under. */
  harness: Harness;
  /** Issue identifier, e.g. "PAN-1201". */
  issueId: string;
  /** Absolute path to the workspace worktree. */
  workspacePath: string;
  /** Issue title, when known. */
  issueTitle?: string;
  /** Feature branch name, when known. */
  branch?: string;
  /** Short vBRIEF summary, when known. */
  vbriefSummary?: string;
  /** Current pipeline phase, when known. */
  phase?: string;
  /** Pre-formatted PAN-1052 memory block, when available. */
  memoryContext?: string;
  /** Pre-formatted live workspace status summary, when available. */
  statusSummary?: string;
}

/**
 * Assemble the workspace-layer bundle for a workspace.
 *
 * Pure: every input is explicit, so the caller decides how much context
 * (memory, status) it can supply. Sections with no content are omitted.
 */
export function assembleWorkspaceContext(input: WorkspaceContextInput): string {
  const sections: string[] = [];

  // 1. Issue metadata header.
  const header = [`# Workspace: ${input.issueId}`, ''];
  if (input.issueTitle) header.push(`**Issue:** ${input.issueId} — ${input.issueTitle}`);
  else header.push(`**Issue:** ${input.issueId}`);
  if (input.branch) header.push(`**Branch:** ${input.branch}`);
  header.push(`**Path:** ${input.workspacePath}`);
  if (input.phase) header.push(`**Phase:** ${input.phase}`);
  if (input.vbriefSummary) {
    header.push('', '## Plan Summary', '', input.vbriefSummary.trim());
  }
  sections.push(header.join('\n'));

  // 2. Parent project layer, rendered for this harness.
  const projectLayer = renderProjectLayer(input.projectRoot, input.harness);
  if (projectLayer) sections.push(projectLayer);

  // 3. Injected memory (PAN-1052).
  if (input.memoryContext && input.memoryContext.trim()) {
    sections.push(input.memoryContext.trim());
  }

  // 4. Live workspace status.
  if (input.statusSummary && input.statusSummary.trim()) {
    sections.push(['## Workspace Status', '', input.statusSummary.trim()].join('\n'));
  }

  return sections.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

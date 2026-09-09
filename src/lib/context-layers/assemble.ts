/**
 * Workspace context assembly (PAN-1201).
 *
 * The persisted workspace layer is harness-neutral. Overdeck assembles it at
 * workspace creation under `<workspace>/.overdeck/context/workspace.md`, then
 * launch-time composition renders global and project sources for the active
 * harness and combines them with this workspace-only content.
 */

const SECTION_SEPARATOR = '\n\n---\n\n';
export const PROJECT_LAYER_START = '<!-- overdeck:project-layer:start';
export const PROJECT_LAYER_END = '<!-- overdeck:project-layer:end -->';
export const WORKSPACE_CONTEXT_V2 = '<!-- overdeck:workspace-context:v2 harness-neutral -->';

function removeMarkedProjectLayer(content: string): string | null {
  const start = content.indexOf(PROJECT_LAYER_START);
  if (start < 0) return null;
  const markerEnd = content.indexOf('-->', start + PROJECT_LAYER_START.length);
  if (markerEnd < 0) return null;
  const marker = content.slice(start, markerEnd + 3);
  const lengthMatch = /\schars=(\d+)\s-->$/.exec(marker);
  if (!lengthMatch) return null;
  const projectStart = markerEnd + 4;
  const projectLength = Number(lengthMatch[1]);
  const projectEnd = projectStart + projectLength;
  if (content[markerEnd + 3] !== '\n') return null;
  if (content.slice(projectEnd, projectEnd + 1 + PROJECT_LAYER_END.length) !== `\n${PROJECT_LAYER_END}`) return null;
  const end = projectEnd + 1;

  let before = content.slice(0, start);
  let after = content.slice(end + PROJECT_LAYER_END.length);
  if (before.endsWith(SECTION_SEPARATOR) && after.startsWith(SECTION_SEPARATOR)) {
    before = before.slice(0, -SECTION_SEPARATOR.length);
  } else if (before.endsWith(SECTION_SEPARATOR)) {
    before = before.slice(0, -SECTION_SEPARATOR.length);
  } else if (after.startsWith(SECTION_SEPARATOR)) {
    after = after.slice(SECTION_SEPARATOR.length);
  }
  return `${before}${after}`.trim();
}

/**
 * Remove a project layer embedded by pre-PAN-3779 workspace assembly.
 *
 * New bundles contain no project layer. Legacy marked bundles can be stripped
 * exactly. For still older unmarked bundles, retain only the generated header
 * before the first separator rather than forwarding unknown harness-filtered
 * project text.
 */
export function workspaceContextWithoutProjectLayer(content: string): string {
  if (content.includes(WORKSPACE_CONTEXT_V2)) return content.trim();
  const marked = removeMarkedProjectLayer(content);
  if (marked !== null) return marked;

  const firstSeparator = content.indexOf(SECTION_SEPARATOR);
  return (firstSeparator < 0 ? content : content.slice(0, firstSeparator)).trim();
}

/** Inputs for {@link assembleWorkspaceContext}. */
export interface WorkspaceContextInput {
  /** Issue identifier, e.g. "PAN-1201". */
  issueId: string;
  /** Absolute path to the workspace worktree. */
  workspacePath: string;
  /** Issue title, when known. */
  issueTitle?: string;
  /** Feature branch name, when known. */
  branch?: string;
  /** Short xBRIEF summary, when known. */
  xbriefSummary?: string;
  /** Current pipeline phase, when known. */
  phase?: string;
  /** Pre-formatted PAN-1052 memory block, when available. */
  memoryContext?: string;
  /** Pre-formatted live workspace status summary, when available. */
  statusSummary?: string;
}

/** Assemble a harness-neutral workspace layer. */
export function assembleWorkspaceContext(input: WorkspaceContextInput): string {
  const sections: string[] = [WORKSPACE_CONTEXT_V2];

  const header = [`# Workspace: ${input.issueId}`, ''];
  if (input.issueTitle) header.push(`**Issue:** ${input.issueId} — ${input.issueTitle}`);
  else header.push(`**Issue:** ${input.issueId}`);
  if (input.branch) header.push(`**Branch:** ${input.branch}`);
  header.push(`**Path:** ${input.workspacePath}`);
  if (input.phase) header.push(`**Phase:** ${input.phase}`);
  if (input.xbriefSummary) {
    header.push('', '## Plan Summary', '', input.xbriefSummary.trim());
  }
  sections.push(header.join('\n'));

  if (input.memoryContext && input.memoryContext.trim()) {
    sections.push(input.memoryContext.trim());
  }

  if (input.statusSummary && input.statusSummary.trim()) {
    sections.push(['## Workspace Status', '', input.statusSummary.trim()].join('\n'));
  }

  return sections.join(SECTION_SEPARATOR).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

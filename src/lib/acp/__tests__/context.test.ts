import { describe, expect, it } from 'vitest';

import {
  PROJECT_LAYER_END,
  PROJECT_LAYER_START,
  workspaceContextWithoutProjectLayer,
} from '../../context-layers/assemble.js';

const SEPARATOR = '\n\n---\n\n';

function markedProject(content: string): string {
  return [`${PROJECT_LAYER_START} chars=${content.length} -->`, content, PROJECT_LAYER_END].join('\n');
}

describe('workspaceContextWithoutProjectLayer', () => {
  it('removes a marked project layer containing Markdown separators', () => {
    const project = markedProject([
      'Generic project rule.',
      '',
      '---',
      '',
      'Claude-only guardrail.',
    ].join('\n'));
    const workspace = [
      '# Workspace: PAN-2858',
      project,
      '<overdeck-memory-context>remember this</overdeck-memory-context>',
      '## Workspace Status\n\nReviewing',
    ].join(SEPARATOR);

    expect(workspaceContextWithoutProjectLayer(workspace)).toBe([
      '# Workspace: PAN-2858',
      '<overdeck-memory-context>remember this</overdeck-memory-context>',
      '## Workspace Status\n\nReviewing',
    ].join(SEPARATOR));
  });

  it('uses the final end marker when project Markdown contains the reserved marker text', () => {
    const project = markedProject([
      'Rule describing the literal marker:',
      PROJECT_LAYER_END,
      'Claude-only content after the literal marker.',
    ].join('\n'));
    const workspace = ['# Workspace: PAN-2858', project, '## Workspace Status\n\nReviewing'].join(SEPARATOR);

    const result = workspaceContextWithoutProjectLayer(workspace);
    expect(result).toContain('# Workspace: PAN-2858');
    expect(result).toContain('## Workspace Status');
    expect(result).not.toContain('Claude-only content');
  });

  it('removes a stale legacy project layer without matching current project text', () => {
    const workspace = [
      '# Workspace: PAN-2858\n\n**Branch:** feature/pan-2858',
      'Old generic rule.\n\n---\n\nOld Claude-only guardrail.',
    ].join(SEPARATOR);

    expect(workspaceContextWithoutProjectLayer(workspace)).toBe(
      '# Workspace: PAN-2858\n\n**Branch:** feature/pan-2858',
    );
  });

  it('conservatively drops ambiguous post-header sections from unmarked legacy bundles', () => {
    const workspace = [
      '# Workspace: PAN-2858',
      'Stale project rules.',
      '<overdeck-memory-context>legacy memory</overdeck-memory-context>',
      '## Workspace Status\n\nReviewing',
    ].join(SEPARATOR);

    expect(workspaceContextWithoutProjectLayer(workspace)).toBe('# Workspace: PAN-2858');
  });

  it('leaves a workspace-only legacy context unchanged', () => {
    const workspace = '# Workspace: PAN-2858\n\nNo embedded project section';
    expect(workspaceContextWithoutProjectLayer(workspace)).toBe(workspace);
  });
});

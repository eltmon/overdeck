import { describe, expect, it } from 'vitest';

import {
  PROJECT_LAYER_END,
  PROJECT_LAYER_START,
  workspaceContextWithoutProjectLayer,
} from '../../context-layers/assemble.js';

const SEPARATOR = '\n\n---\n\n';

describe('workspaceContextWithoutProjectLayer', () => {
  it('removes a marked project layer containing Markdown separators', () => {
    const project = [
      PROJECT_LAYER_START,
      'Generic project rule.',
      '',
      '---',
      '',
      'Claude-only guardrail.',
      PROJECT_LAYER_END,
    ].join('\n');
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

  it('removes a stale legacy project layer without matching current project text', () => {
    const workspace = [
      '# Workspace: PAN-2858\n\n**Branch:** feature/pan-2858',
      'Old generic rule.\n\n---\n\nOld Claude-only guardrail.',
    ].join(SEPARATOR);

    expect(workspaceContextWithoutProjectLayer(workspace)).toBe(
      '# Workspace: PAN-2858\n\n**Branch:** feature/pan-2858',
    );
  });

  it('leaves a workspace-only legacy context unchanged', () => {
    const workspace = '# Workspace: PAN-2858\n\nNo embedded project section';
    expect(workspaceContextWithoutProjectLayer(workspace)).toBe(workspace);
  });
});

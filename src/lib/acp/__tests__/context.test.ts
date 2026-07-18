import { describe, expect, it } from 'vitest';

import { removeEmbeddedProjectLayer } from '../context.js';

const SEPARATOR = '\n\n---\n\n';

describe('removeEmbeddedProjectLayer', () => {
  it('removes the stale pre-rendered project section while preserving workspace-only context', () => {
    const staleClaudeProject = [
      'Generic project rule.',
      'Claude-only guardrail.',
    ].join('\n');
    const workspace = [
      '# Workspace: PAN-2858',
      staleClaudeProject,
      '<overdeck-memory-context>remember this</overdeck-memory-context>',
      '## Workspace Status\n\nReviewing',
    ].join(SEPARATOR);

    expect(removeEmbeddedProjectLayer(workspace, staleClaudeProject)).toBe([
      '# Workspace: PAN-2858',
      '<overdeck-memory-context>remember this</overdeck-memory-context>',
      '## Workspace Status\n\nReviewing',
    ].join(SEPARATOR));
  });

  it('leaves workspace content unchanged when no embedded project layer exists', () => {
    const workspace = '# Workspace: PAN-2858\n\nNo project section';
    expect(removeEmbeddedProjectLayer(workspace, 'Project rule')).toBe(workspace);
  });
});

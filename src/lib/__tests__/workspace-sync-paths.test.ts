import { describe, expect, it } from 'vitest';
import { isOverdeckWorkspaceSyncPath } from '../workspace-sync-paths.js';

describe('isOverdeckWorkspaceSyncPath', () => {
  it.each([
    '.claude',
    '.claude/settings.json',
    '.claude/agents/pan-work-agent.md',
    '.mcp.json',
    '.hume-config',
    '.env',
    '.pan/review/x.md',
  ])('returns true for %s', path => {
    expect(isOverdeckWorkspaceSyncPath(path)).toBe(true);
  });

  it.each(['notes.txt', '.mcp.json.bak', '.claude-notes.md', 'src/.env', '.envrc'])(
    'returns false for %s',
    path => {
      expect(isOverdeckWorkspaceSyncPath(path)).toBe(false);
    },
  );
});

import type { Dirent, Stats } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sweepTranscriptRetention,
  type TranscriptRetentionDeps,
} from '../../../../src/lib/cloister/transcript-retention.js';

const AGENTS_DIR = '/agents';
const NOW = new Date('2026-09-20T12:00:00.000Z');

function dirent(name: string, kind: 'dir' | 'file'): Dirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  } as unknown as Dirent;
}

describe('sweepTranscriptRetention filesystem boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it('enumerates only agent-local artifacts and never computes a ~/.claude path', async () => {
    const visited: string[] = [];
    const removedFiles: string[] = [];
    const removedTrees: string[] = [];
    const dirs: Record<string, Array<[string, 'dir' | 'file']>> = {
      '/agents': [['agent-pan-3950', 'dir']],
      '/agents/agent-pan-3950': [['activity.jsonl', 'file'], ['codex-home-v2', 'dir']],
      '/agents/agent-pan-3950/codex-home-v2/sessions': [['2026', 'dir']],
      '/agents/agent-pan-3950/codex-home-v2/sessions/2026': [['09', 'dir']],
      '/agents/agent-pan-3950/codex-home-v2/sessions/2026/09': [['rollout-old.jsonl', 'file']],
    };
    const deps: Partial<TranscriptRetentionDeps> = {
      readDir: async (path) => {
        visited.push(path);
        const entries = dirs[path];
        if (entries) return entries.map(([name, kind]) => dirent(name, kind));
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
      stat: async () => ({ mtimeMs: NOW.getTime() - 60 * 24 * 60 * 60 * 1000 }) as Stats,
      removeFile: async (path) => { removedFiles.push(path); },
      removeTree: async (path) => { removedTrees.push(path); },
      listSessionNames: async () => [],
      listConversations: () => [],
      listArchivedConversations: () => [],
      log: () => {},
    };

    await sweepTranscriptRetention({ transcriptDays: 30, agentsDir: AGENTS_DIR, deps });

    expect(removedFiles).toEqual([
      '/agents/agent-pan-3950/codex-home-v2/sessions/2026/09/rollout-old.jsonl',
    ]);
    expect(removedTrees).toEqual(['/agents/agent-pan-3950']);
    expect(visited.every((path) => path.startsWith('/agents'))).toBe(true);
    expect(visited.join('\n')).not.toContain('.claude');
  });
});

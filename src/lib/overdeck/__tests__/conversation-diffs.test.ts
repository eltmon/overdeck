import { describe, expect, it, vi, beforeEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ exec: execMock }));

const checkpointMocks = vi.hoisted(() => ({
  findCommitAtTime: vi.fn(),
  diffFilesAgainstHead: vi.fn(),
}));
vi.mock('../../checkpoint/checkpoint-manager.js', () => ({
  findCommitAtTime: checkpointMocks.findCommitAtTime,
  diffFilesAgainstHead: checkpointMocks.diffFilesAgainstHead,
  diffPatchSinceCommit: vi.fn(),
  diffPatchFilesAgainstHead: vi.fn(),
}));

const conversationMocks = vi.hoisted(() => ({
  getConversationByName: vi.fn(),
  getConversationById: vi.fn(),
}));
vi.mock('../conversations.js', () => ({
  getConversationByName: conversationMocks.getConversationByName,
  getConversationById: conversationMocks.getConversationById,
}));

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

import { getConversationDiffs } from '../conversation-diffs.js';
import type { LegacyConversation } from '../conversations.js';

type ExecCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

describe('getConversationDiffs', () => {
  beforeEach(() => {
    execMock.mockReset();
    checkpointMocks.findCommitAtTime.mockReset();
    checkpointMocks.diffFilesAgainstHead.mockReset();
    conversationMocks.getConversationByName.mockReset();
    conversationMocks.getConversationById.mockReset();
  });

  it('runs one git diff pair per repo, scopes each summary to its own turn, and repeats shared paths with matching numbers', async () => {
    conversationMocks.getConversationByName.mockReturnValue({
      id: 1,
      name: 'conv-1',
      createdAt: '2025-12-01T00:00:00Z',
    } as unknown as LegacyConversation);
    checkpointMocks.findCommitAtTime.mockResolvedValue('abc123');

    let revParseCalls = 0;
    let numstatCalls = 0;
    let nameStatusCalls = 0;
    execMock.mockImplementation((command: string, _options: unknown, callback: ExecCallback) => {
      if (/git rev-parse --show-toplevel/.test(command)) {
        revParseCalls += 1;
        callback(null, { stdout: '/repo\n', stderr: '' });
      } else if (/git diff --numstat/.test(command)) {
        numstatCalls += 1;
        callback(null, {
          stdout: [
            '3\t1\tfile1.ts',
            '2\t0\tfile2.ts',
            '1\t1\tfile3.ts',
            '5\t2\tfile4.ts',
            '4\t3\tfile5.ts',
          ].join('\n'),
          stderr: '',
        });
      } else if (/git diff --name-status/.test(command)) {
        nameStatusCalls += 1;
        callback(null, {
          stdout: [
            'M\tfile1.ts',
            'M\tfile2.ts',
            'M\tfile3.ts',
            'M\tfile4.ts',
            'M\tfile5.ts',
          ].join('\n'),
          stderr: '',
        });
      } else {
        callback(new Error(`unexpected command: ${command}`), { stdout: '', stderr: '' });
      }
    });

    const fileEditsByAssistantId = new Map<string, Array<{ tool: string; filePath: string }>>([
      ['asst-1', [{ tool: 'Edit', filePath: '/repo/file1.ts' }]],
      ['asst-2', [{ tool: 'Edit', filePath: '/repo/file2.ts' }]],
      ['asst-3', [{ tool: 'Edit', filePath: '/repo/file3.ts' }]],
      ['asst-4', [{ tool: 'Edit', filePath: '/repo/file4.ts' }]],
      // asst-5 re-edits file1.ts (already touched by asst-1) and also file5.ts.
      ['asst-5', [{ tool: 'Edit', filePath: '/repo/file1.ts' }, { tool: 'Edit', filePath: '/repo/file5.ts' }]],
    ]);
    const messages = ['asst-1', 'asst-2', 'asst-3', 'asst-4', 'asst-5'].map((id, i) => ({
      role: 'assistant' as const,
      id,
      createdAt: `2026-01-0${i + 1}T00:00:00Z`,
      completedAt: `2026-01-0${i + 1}T00:00:01Z`,
    }));

    const result = await getConversationDiffs('conv-1', {
      resolveSessionFile: async () => '/tmp/session.jsonl',
      getCachedMessages: async () => ({ messages, fileEditsByAssistantId }),
    });
    const body = result.body as { summaries: Array<{ assistantMessageId: string; files: Array<{ path: string; kind?: string; additions: number; deletions: number }> }> };

    // AC1 — one diff pair for the whole repo, not one pair per turn.
    expect(numstatCalls).toBe(1);
    expect(nameStatusCalls).toBe(1);
    expect(revParseCalls).toBe(1);

    // AC2 — each summary lists only the paths its own turn edited.
    expect(body.summaries).toHaveLength(5);
    const byTurn = new Map(body.summaries.map(s => [s.assistantMessageId, s]));
    expect(byTurn.get('asst-1')?.files.map(f => f.path)).toEqual(['file1.ts']);
    expect(byTurn.get('asst-2')?.files.map(f => f.path)).toEqual(['file2.ts']);
    expect(byTurn.get('asst-5')?.files.map(f => f.path)).toEqual(['file1.ts', 'file5.ts']);

    // AC3 — a path edited in two turns appears in both, with the same numbers.
    const turn1File1 = byTurn.get('asst-1')?.files.find(f => f.path === 'file1.ts');
    const turn5File1 = byTurn.get('asst-5')?.files.find(f => f.path === 'file1.ts');
    expect(turn1File1).toEqual({ path: 'file1.ts', kind: 'M', additions: 3, deletions: 1 });
    expect(turn5File1).toEqual(turn1File1);
  });
});

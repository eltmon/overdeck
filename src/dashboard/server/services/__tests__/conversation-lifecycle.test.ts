import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the conversations-db module
const mockListActiveConversations = vi.fn();
const mockMarkConversationEnded = vi.fn();
const mockCleanupUnreferencedConversationAttachments = vi.fn();
const mockListSessionNames = vi.fn();
const mockCreateConversation = vi.fn();
const mockGetConversationByClaudeSessionId = vi.fn();
const mockGetConversationByName = vi.fn();
const mockSetClearedToConvId = vi.fn();

vi.mock('../../../../lib/database/conversations-db.js', () => ({
  listActiveConversations: mockListActiveConversations,
  markConversationEnded: mockMarkConversationEnded,
  createConversation: mockCreateConversation,
  getConversationByClaudeSessionId: mockGetConversationByClaudeSessionId,
  getConversationByName: mockGetConversationByName,
  setClearedToConvId: mockSetClearedToConvId,
}));

vi.mock('../conversation-attachments.js', () => ({
  cleanupUnreferencedConversationAttachments: mockCleanupUnreferencedConversationAttachments,
  runInBatches: async (
    items: unknown[],
    _batchSize: number,
    fn: (item: unknown) => Promise<unknown>,
  ) => {
    for (const item of items) {
      await fn(item);
    }
  },
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNames: mockListSessionNames,
}));

// Mock node:child_process so no real tmux processes are spawned
vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: vi.fn((fn: unknown) => fn) }));

describe('ConversationLifecycleService — pollConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks active conversations as ended when session is not in tmux list', async () => {
    // No claudeSessionId on the conversation → sessionFile should resolve to null
    // (production computes sessionFile via sessionFilePath(cwd, claudeSessionId)
    // and falls back to null when claudeSessionId is missing).
    mockListActiveConversations.mockReturnValue([
      { name: 'gone-session', tmuxSession: 'conv-gone-session', status: 'active', cwd: '/tmp/work', claudeSessionId: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed([])); // no sessions alive

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListSessionNames).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone-session');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone-session', sessionFile: null }),
    );
  });

  it('does NOT mark conversations as ended when session is in tmux list', async () => {
    mockListActiveConversations.mockReturnValue([
      { name: 'alive-session', tmuxSession: 'conv-alive-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-alive-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
  });

  it('uses listActiveConversations so ended sessions are already filtered out', async () => {
    mockListActiveConversations.mockReturnValue([
      // listActiveConversations only returns active conversations
      { name: 'active-session', tmuxSession: 'conv-active-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-active-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListActiveConversations).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('handles empty conversation list without errors', async () => {
    mockListActiveConversations.mockReturnValue([]);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await expect(pollConversations()).resolves.toBeUndefined();
    expect(mockListSessionNames).not.toHaveBeenCalled();
  });

  it('marks only gone sessions when multiple active conversations', async () => {
    mockListActiveConversations.mockReturnValue([
      { name: 'alive', tmuxSession: 'conv-alive', status: 'active', sessionFile: '/tmp/alive.jsonl' },
      { name: 'gone', tmuxSession: 'conv-gone', status: 'active', sessionFile: '/tmp/gone.jsonl' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-alive']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListSessionNames).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledTimes(1);
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone' }),
    );
  });

  it('does not throw when listActiveConversations errors', async () => {
    mockListActiveConversations.mockImplementation(() => { throw new Error('DB error'); });

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await expect(pollConversations()).resolves.toBeUndefined();
  });
});

describe('ConversationLifecycleService — detectOrphanedClaudeCodeSessions (PAN-1458)', () => {
  // Each test uses a fresh tmp $HOME so the encoded ~/.claude/projects/<cwd> path is isolated.
  let fakeHome: string;
  let projectDir: string;
  let cwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), 'pan-clear-orphan-'));
    cwd = '/work/myproj';
    // encodeClaudeProjectDir(/work/myproj) → -work-myproj (slashes/dots collapse to dashes)
    projectDir = join(fakeHome, '.claude', 'projects', '-work-myproj');
    mkdirSync(projectDir, { recursive: true });
    vi.stubEnv('HOME', fakeHome);
  });

  function writeJsonl(filename: string, lines: object[], mtimeMs: number): string {
    const filepath = join(projectDir, filename);
    writeFileSync(filepath, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8');
    const mtimeSec = mtimeMs / 1000;
    utimesSync(filepath, mtimeSec, mtimeSec);
    return filepath;
  }

  it('adopts a post-/clear orphan and links the parent conversation', async () => {
    const parentSessionId = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
    const orphanSessionId = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

    // Parent's JSONL — older mtime
    writeJsonl(
      `${parentSessionId}.jsonl`,
      [
        { type: 'user', message: { role: 'user', content: 'hello world' }, timestamp: '2026-05-24T19:30:00.000Z' },
      ],
      Date.parse('2026-05-24T19:48:00.000Z'),
    );

    // Orphan's JSONL — /clear sentinel on line 2, mtime AFTER parent
    writeJsonl(
      `${orphanSessionId}.jsonl`,
      [
        { type: 'file-history-snapshot', messageId: 'x', snapshot: {}, isSnapshotUpdate: false },
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' },
          timestamp: '2026-05-24T19:50:00.000Z',
        },
      ],
      Date.parse('2026-05-24T19:50:30.000Z'),
    );

    const parent = {
      id: 100,
      name: 'parent-conv',
      tmuxSession: 'conv-parent',
      status: 'active',
      cwd,
      issueId: 'PAN-123',
      claudeSessionId: parentSessionId,
      title: 'Original work',
      titleSource: 'ai',
      titleSeed: null,
      totalCost: 0,
      archivedAt: null,
      model: 'claude-opus-4-7',
      effort: null,
      forkStatus: null,
      forkError: null,
      harness: 'claude-code',
      deliveryMethod: null,
      spawnError: null,
      handoffDocPath: null,
      handoffTargetConvId: null,
      forkFallbackReason: null,
      clearedToConvId: null,
      createdAt: '2026-05-24T19:00:00.000Z',
      endedAt: null,
      lastAttachedAt: '2026-05-24T19:48:00.000Z',
    };

    mockListActiveConversations.mockReturnValue([parent]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-parent']));
    mockGetConversationByClaudeSessionId.mockImplementation((id: string) =>
      id === parentSessionId ? parent : null,
    );
    mockCreateConversation.mockReturnValue({ id: 200, name: 'parent-conv-post-clear-bbbbbbbb' });

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'parent-conv-post-clear-bbbbbbbb',
        tmuxSession: 'conv-parent',
        cwd,
        issueId: 'PAN-123',
        claudeSessionId: orphanSessionId,
        title: '[post-/clear] Original work',
        titleSource: 'auto',
        titleSeed: '[post-/clear] Original work',
        model: 'claude-opus-4-7',
        harness: 'claude-code',
      }),
    );
    expect(mockSetClearedToConvId).toHaveBeenCalledWith('parent-conv', 200);
  });

  it('skips JSONLs that are already linked to a conversation', async () => {
    const known = 'cccccccc-3333-3333-3333-cccccccccccc';
    writeJsonl(
      `${known}.jsonl`,
      [
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/clear</command-name>' },
          timestamp: '2026-05-24T19:50:00.000Z',
        },
      ],
      Date.parse('2026-05-24T19:50:30.000Z'),
    );

    mockListActiveConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', status: 'active', cwd, claudeSessionId: 'parent-uuid', harness: 'claude-code', title: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-p']));
    mockGetConversationByClaudeSessionId.mockReturnValue({ id: 999 }); // every session lookup says "known"

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockSetClearedToConvId).not.toHaveBeenCalled();
  });

  it('skips orphans with no Panopticon parent in the same cwd', async () => {
    const orphan = 'dddddddd-4444-4444-4444-dddddddddddd';
    writeJsonl(
      `${orphan}.jsonl`,
      [
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/clear</command-name>' },
          timestamp: '2026-05-24T19:50:00.000Z',
        },
      ],
      Date.parse('2026-05-24T19:50:30.000Z'),
    );

    // No active conversation has this cwd
    mockListActiveConversations.mockReturnValue([]);
    mockListSessionNames.mockReturnValue(Effect.succeed([]));
    mockGetConversationByClaudeSessionId.mockReturnValue(null);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('does not adopt JSONLs without the /clear sentinel', async () => {
    const parent = 'eeeeeeee-5555-5555-5555-eeeeeeeeeeee';
    const peer = 'ffffffff-6666-6666-6666-ffffffffffff';

    writeJsonl(
      `${parent}.jsonl`,
      [{ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-05-24T19:30:00.000Z' }],
      Date.parse('2026-05-24T19:48:00.000Z'),
    );
    // Peer JSONL — no /clear sentinel (e.g., a standalone Claude Code session that started independently)
    writeJsonl(
      `${peer}.jsonl`,
      [{ type: 'user', message: { role: 'user', content: 'hello from another session' }, timestamp: '2026-05-24T19:50:00.000Z' }],
      Date.parse('2026-05-24T19:50:30.000Z'),
    );

    mockListActiveConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', status: 'active', cwd, claudeSessionId: parent, harness: 'claude-code', title: 'parent' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-p']));
    mockGetConversationByClaudeSessionId.mockImplementation((id: string) => (id === parent ? { id: 1 } : null));

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
});

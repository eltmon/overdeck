import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the conversations-db module
const mockListConversations = vi.fn();
const mockMarkConversationEnded = vi.fn();
const mockMarkConversationRunning = vi.fn();
const mockCleanupUnreferencedConversationAttachments = vi.fn();
const mockListSessionNames = vi.fn();
const mockIsHarnessProcessAlive = vi.fn();
const mockListPaneValues = vi.fn();
const mockCreateConversation = vi.fn();
const mockGetConversationByClaudeSessionId = vi.fn();
const mockGetConversationByName = vi.fn();
const mockSetClearedToConvId = vi.fn();

vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  listConversations: mockListConversations,
  markConversationEnded: mockMarkConversationEnded,
  markConversationRunning: mockMarkConversationRunning,
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
  isHarnessProcessAlive: mockIsHarnessProcessAlive,
  listPaneValues: mockListPaneValues,
}));

const mockIsRespawnPending = vi.fn();
vi.mock('../pending-respawn.js', () => ({
  isRespawnPending: mockIsRespawnPending,
}));

// Mock node:child_process so no real tmux processes are spawned
vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: vi.fn((fn: unknown) => fn) }));

describe('ConversationLifecycleService — pollConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: harness alive in sessions that exist (corpse cases set false explicitly).
    mockIsHarnessProcessAlive.mockResolvedValue(true);
    mockIsRespawnPending.mockReturnValue(false);
    // Default: no dead-pane status available (corpse-diagnostics cases set it).
    mockListPaneValues.mockReturnValue(Effect.succeed([]));
  });

  it('marks active conversations as ended when session is not in tmux list', async () => {
    // No claudeSessionId on the conversation → sessionFile should resolve to null
    // (production computes sessionFile via sessionFilePath(cwd, claudeSessionId)
    // and falls back to null when claudeSessionId is missing).
    mockListConversations.mockReturnValue([
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
    mockListConversations.mockReturnValue([
      { name: 'alive-session', tmuxSession: 'conv-alive-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-alive-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
  });

  it('fetches the list exactly once per poll', async () => {
    mockListConversations.mockReturnValue([
      { name: 'active-session', tmuxSession: 'conv-active-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-active-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListConversations).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('skips already-ended conversations whose session is gone — no re-mark, no re-cleanup (PAN-2215)', async () => {
    mockListConversations.mockReturnValue([
      {
        name: 'dead-long-ago',
        tmuxSession: 'conv-dead-long-ago',
        status: 'ended',
        cwd: '/tmp/work',
        claudeSessionId: null,
        createdAt: '2026-05-24T19:00:00.000Z',
      },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed([])); // no sessions alive

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockMarkConversationRunning).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
    // The skip is O(1) — no per-row re-read either.
    expect(mockGetConversationByName).not.toHaveBeenCalled();
  });

  it('resurrects an ended conversation whose session and harness are alive (PAN-1972)', async () => {
    mockListConversations.mockReturnValue([
      {
        name: 'latched-ended',
        tmuxSession: 'conv-latched-ended',
        status: 'ended',
        cwd: '/tmp/work',
        claudeSessionId: null,
        createdAt: '2026-05-24T19:00:00.000Z',
      },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-latched-ended']));
    mockIsHarnessProcessAlive.mockResolvedValue(true);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationRunning).toHaveBeenCalledWith('latched-ended');
    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('handles empty conversation list without errors', async () => {
    mockListConversations.mockReturnValue([]);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await expect(pollConversations()).resolves.toBeUndefined();
    expect(mockListSessionNames).not.toHaveBeenCalled();
  });

  it('marks only gone sessions when multiple active conversations', async () => {
    mockListConversations.mockReturnValue([
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

  it('marks a session that is alive but whose harness process has exited (keep-alive corpse)', async () => {
    mockListConversations.mockReturnValue([
      { name: 'corpse', tmuxSession: 'conv-corpse', status: 'active', cwd: '/tmp/work', claudeSessionId: null },
    ]);
    // tmux session IS in the alive list, but the harness process is dead — only
    // the launcher keep-alive `sleep` loop remains. PAN-1638.
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-corpse']));
    mockIsHarnessProcessAlive.mockResolvedValue(false);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('corpse');
  });

  it('captures pane exit status + output.log tail when marking a keep-alive corpse (PAN-2099)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'odh-'));
    const prevHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
    const agentDir = join(home, 'agents', 'conv-diag');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'output.log'),
      'earlier noise line\n[Uncaught Exception] Error: ENOSPC: no space left on device, write\nPane is dead (status 1)\n',
    );

    mockListConversations.mockReturnValue([
      { name: 'diag', tmuxSession: 'conv-diag', status: 'active', cwd: '/tmp/work', claudeSessionId: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-diag']));
    mockIsHarnessProcessAlive.mockResolvedValue(false);
    mockListPaneValues.mockReturnValue(Effect.succeed(['1']));
    mockCleanupUnreferencedConversationAttachments.mockResolvedValue(undefined);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let loggedLines: string[] = [];
    try {
      const { pollConversations } = await import('../conversation-lifecycle.js');
      await pollConversations();
      loggedLines = logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
      if (prevHome === undefined) delete process.env.OVERDECK_HOME;
      else process.env.OVERDECK_HOME = prevHome;
    }

    expect(mockMarkConversationEnded).toHaveBeenCalledWith('diag');
    const corpseLine = loggedLines.find((l) => l.includes('keep-alive corpse'));
    expect(corpseLine).toBeDefined();
    expect(corpseLine).toContain('exitStatus=1');
    expect(corpseLine).toContain('ENOSPC');
  });

  it('does NOT mark a corpse ended while a respawn is in flight for its session', async () => {
    mockListConversations.mockReturnValue([
      { name: 'reviving', tmuxSession: 'conv-reviving', status: 'active', cwd: '/tmp/work', claudeSessionId: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-reviving']));
    mockIsHarnessProcessAlive.mockResolvedValue(false);
    // Resume endpoint is mid kill→spawn→ready for this session.
    mockIsRespawnPending.mockReturnValue(true);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('does NOT mark ended when a re-read shows a fresh spawn/attach signal (resume raced the poll)', async () => {
    // Poll-start snapshot: old conversation, harness looks dead (launcher shell
    // still foreground mid-respawn). By mark time, the resume has bumped
    // last_attached_at — the conversation was just revived.
    mockListConversations.mockReturnValue([
      {
        name: 'resumed', tmuxSession: 'conv-resumed', status: 'active', cwd: '/tmp/work',
        claudeSessionId: null, createdAt: '2026-06-09T04:04:38.330Z', lastAttachedAt: null,
      },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-resumed']));
    mockIsHarnessProcessAlive.mockResolvedValue(false);
    mockGetConversationByName.mockReturnValue({
      name: 'resumed', tmuxSession: 'conv-resumed', status: 'active', cwd: '/tmp/work',
      claudeSessionId: null, createdAt: '2026-06-09T04:04:38.330Z',
      lastAttachedAt: new Date().toISOString(),
    });

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('still marks a corpse ended when the re-read shows no recent spawn/attach signal', async () => {
    const stale = '2026-06-09T04:04:38.330Z';
    mockListConversations.mockReturnValue([
      {
        name: 'true-corpse', tmuxSession: 'conv-true-corpse', status: 'active', cwd: '/tmp/work',
        claudeSessionId: null, createdAt: stale, lastAttachedAt: stale,
      },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-true-corpse']));
    mockIsHarnessProcessAlive.mockResolvedValue(false);
    mockGetConversationByName.mockReturnValue({
      name: 'true-corpse', tmuxSession: 'conv-true-corpse', status: 'active', cwd: '/tmp/work',
      claudeSessionId: null, createdAt: stale, lastAttachedAt: stale,
    });

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).toHaveBeenCalledWith('true-corpse');
  });

  it('does not throw when listConversations errors', async () => {
    mockListConversations.mockImplementation(() => { throw new Error('DB error'); });

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
    // Default: harness alive in sessions that exist (corpse cases set false explicitly).
    mockIsHarnessProcessAlive.mockResolvedValue(true);
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

    mockListConversations.mockReturnValue([parent]);
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
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('parent-conv');
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

    mockListConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', status: 'active', cwd, claudeSessionId: 'parent-uuid', harness: 'claude-code', title: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-p']));
    mockGetConversationByClaudeSessionId.mockReturnValue({ id: 999 }); // every session lookup says "known"

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockSetClearedToConvId).not.toHaveBeenCalled();
  });

  it('skips orphans with no Overdeck parent in the same cwd', async () => {
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
    mockListConversations.mockReturnValue([]);
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

    mockListConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', status: 'active', cwd, claudeSessionId: parent, harness: 'claude-code', title: 'parent' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-p']));
    mockGetConversationByClaudeSessionId.mockImplementation((id: string) => (id === parent ? { id: 1 } : null));

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('excludes ended conversations from orphan detection so their cwd is never scanned (PAN-2215)', async () => {
    const orphan = 'abcdabcd-7777-7777-7777-abcdabcdabcd';
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

    // The only conversation rooted at this cwd is ended — its project dir must
    // not be readdir'd or have its transcripts opened.
    mockListConversations.mockReturnValue([
      { id: 1, name: 'was-here', tmuxSession: 'conv-was-here', status: 'ended', cwd, claudeSessionId: 'gone-uuid', harness: 'claude-code', title: null, createdAt: '2026-05-24T19:00:00.000Z' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed([]));
    mockGetConversationByClaudeSessionId.mockReturnValue(null);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();

    expect(mockGetConversationByClaudeSessionId).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('scans a definitively-non-orphan transcript only once per boot (PAN-2215 seen-cache)', async () => {
    const parent = '99999999-8888-8888-8888-999999999999';
    const peer = '12121212-3434-3434-3434-121212121212';

    writeJsonl(
      `${parent}.jsonl`,
      [{ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-05-24T19:30:00.000Z' }],
      Date.parse('2026-05-24T19:48:00.000Z'),
    );
    // Six full lines with no /clear sentinel → the null verdict is definitive
    // (the 5-line detection window is provably complete), so the second poll
    // must skip this file entirely — no DB lookup, no file open.
    writeJsonl(
      `${peer}.jsonl`,
      Array.from({ length: 6 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `line ${i}` },
        timestamp: '2026-05-24T19:50:00.000Z',
      })),
      Date.parse('2026-05-24T19:50:30.000Z'),
    );

    mockListConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', status: 'active', cwd, claudeSessionId: parent, harness: 'claude-code', title: 'parent' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-p']));
    mockGetConversationByClaudeSessionId.mockImplementation((id: string) => (id === parent ? { id: 1 } : null));

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await pollConversations();
    await pollConversations();

    const peerLookups = mockGetConversationByClaudeSessionId.mock.calls.filter(([id]) => id === peer);
    expect(peerLookups).toHaveLength(1);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
});

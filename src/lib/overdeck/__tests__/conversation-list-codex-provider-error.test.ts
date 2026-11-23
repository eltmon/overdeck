/**
 * PAN-5633 WI-3: a live Codex conversation whose newest turn failed carries a
 * providerError built from the rollout's task_complete.error.
 */
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodexTurnFailure } from '../../conversations/codex-thread-status.js';

const fixture = vi.hoisted(() => ({ rollout: '', authPath: '', list: vi.fn() }));

vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: async () => [] }));
vi.mock('../conversations.js', () => ({
  listConversations: fixture.list, listFavoritedIds: () => [], markConversationRunning: vi.fn(), markConversationEnded: vi.fn(),
}));
vi.mock('../../tmux.js', () => ({ listSessionNames: () => Effect.succeed([]), isHarnessProcessAlive: vi.fn() }));
vi.mock('../conversation-liveness.js', () => ({
  listLiveConversationSessions: async () => new Set(['conv-codex-a']),
  conversationHarnessAlive: async () => true,
}));
vi.mock('../conversation-reads.js', () => ({
  resolveSessionFile: async () => fixture.rollout,
  conversationTranscriptMissing: () => false,
  conversationNeedsTerminal: async () => false,
  askUserQuestionSnapshotFromScan: () => undefined,
}));
vi.mock('../../agents.js', () => ({ getAgentRuntimeStateSync: () => null }));
vi.mock('../../../dashboard/server/services/conversation-service.js', () => ({
  summarizeConversationActivity: async () => ({ messages: [], streaming: false, isWorking: false, currentTool: null }),
}));
vi.mock('../../agent-enrichment.js', () => ({ scanPendingInputs: async () => ({}) }));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({ kinds: [] }) }));
vi.mock('../conversation-pull-requests.js', () => ({ listPullRequestLinksForConversations: () => new Map() }));
vi.mock('../conversation-input-target.js', () => ({ readConversationInputTarget: async () => undefined }));
vi.mock('../../../dashboard/server/services/git-info.js', () => ({
  resolveConversationGitInfo: async () => ({ branch: 'main', isWorktree: false }),
}));
vi.mock('../../codex-auth.js', () => ({ getNativeCodexAuthPath: () => fixture.authPath }));

import { codexProviderErrorFromFailure } from '../codex-provider-error.js';
import { getEnrichedConversationList, invalidateConversationListEnrichmentCache } from '../conversation-list.js';

const AUTH_ERROR = 'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.';
const FAILED_AT = '2026-11-23T17:33:20.000Z';

function failure(kind: CodexTurnFailure['kind'], code: string | null, message = 'boom'): CodexTurnFailure {
  return { message, at: FAILED_AT, code, kind };
}

describe('codexProviderErrorFromFailure (PAN-5633)', () => {
  const failedMs = Date.parse(FAILED_AT);

  it('auth, not recovered: tells the operator to re-authenticate', () => {
    const error = codexProviderErrorFromFailure(failure('auth', 'unauthorized', AUTH_ERROR), failedMs - 60_000);
    expect(error).toMatchObject({ at: FAILED_AT, status: null, code: 'unauthorized', usageLimit: null, kind: 'auth', authRecovered: false });
    expect(error.message).toMatch(/^Codex sign-in failed\. Re-authenticate from the Codex banner\. Last error: Your access token/);
  });

  it('auth, recovered: auth.json was rewritten after the failure', () => {
    const error = codexProviderErrorFromFailure(failure('auth', 'unauthorized', AUTH_ERROR), failedMs + 60_000);
    expect(error.authRecovered).toBe(true);
    expect(error.message).toMatch(/^Codex sign-in is fixed\. Send a message to resume\./);
  });

  it('context-window: says the context is full and to hand off', () => {
    const error = codexProviderErrorFromFailure(failure('context-window', 'context_window_exceeded'), null);
    expect(error.kind).toBe('context-window');
    expect(error).not.toHaveProperty('authRecovered');
    expect(error.message).toBe('The context window is full and compaction failed. Hand this conversation off to a new one. Last error: boom');
  });

  it('other: keeps the raw message and caps it at 300 characters', () => {
    expect(codexProviderErrorFromFailure(failure('other', 'internal_server_error'), null).message).toBe('boom');
    const long = codexProviderErrorFromFailure(failure('context-window', null, 'x'.repeat(400)), null);
    expect(long.message).toHaveLength(300);
  });
});

describe('conversation list providerError for Codex rows (PAN-5633)', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    invalidateConversationListEnrichmentCache();
    dir = await mkdtemp(join(tmpdir(), 'conv-list-codex-'));
    fixture.rollout = join(dir, 'rollout.jsonl');
    fixture.authPath = join(dir, 'auth.json');
    await writeFile(fixture.authPath, '{}');
    // The last sign-in happened a minute before the failure.
    const signedIn = new Date(Date.parse(FAILED_AT) - 60_000);
    await utimes(fixture.authPath, signedIn, signedIn);
    fixture.list.mockReturnValue([{
      id: 1, name: 'codex-a', tmuxSession: 'conv-codex-a', status: 'active', harness: 'codex', cwd: '/fixture',
      projectKey: 'project', title: 'codex-a', totalCost: 0, totalTokens: 0,
    }]);
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function writeRollout(taskComplete: Record<string, unknown>): Promise<void> {
    const lines = [
      { timestamp: '2026-11-23T17:33:10.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
      { timestamp: FAILED_AT, type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', ...taskComplete } },
    ];
    await writeFile(fixture.rollout, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  it('a live codex row whose last turn failed carries providerError with kind auth', async () => {
    await writeRollout({ last_agent_message: null, error: { message: AUTH_ERROR, codex_error_info: 'unauthorized' } });

    const [row] = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    expect(row.sessionAlive).toBe(true);
    expect(row.providerError).toMatchObject({ kind: 'auth', authRecovered: false, code: 'unauthorized', at: FAILED_AT });
    expect((row.providerError as { message: string }).message).toMatch(/^Codex sign-in failed/);
  });

  it('a live codex row whose last turn succeeded carries providerError null', async () => {
    await writeRollout({ last_agent_message: 'Done.' });

    const [row] = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    expect(row.sessionAlive).toBe(true);
    expect(row.providerError).toBeNull();
  });
});

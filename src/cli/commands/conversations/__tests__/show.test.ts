/**
 * Regression tests for `pan conversations show` (PAN-457, PAN-2018).
 *
 * PAN-2018: `<id>` resolves as a conversation first (matching `pan conv jsonl`
 * and the dashboard `/conv/<id>` route), falling back to the discovered-session
 * scan-order index only when no conversation matches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.clearAllMocks();
});

async function seedSession(overrides: Record<string, unknown> = {}) {
  const { upsertDiscoveredSession } = await import('../../../../lib/overdeck/discovered-sessions.js');
  return upsertDiscoveredSession({
    jsonlPath: '/fake/show-test.jsonl',
    workspacePath: '/home/user/Projects/myapp',
    workspaceHash: 'abc123',
    messageCount: 10,
    firstTs: '2025-01-01T00:00:00Z',
    lastTs: '2025-01-01T01:00:00Z',
    modelsUsed: ['claude-sonnet-4-6'],
    primaryModel: 'claude-sonnet-4-6',
    tokenInput: 500,
    tokenOutput: 1000,
    estimatedCost: 0.05,
    toolsUsed: ['Read', 'Write'],
    filesTouched: [],
    overdeckManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: 2048,
    fileMtime: '2025-01-01T00:00:00Z',
    tags: ['feat'],
    ...overrides,
  });
}

describe('showAction', () => {
  it('exits 1 for non-numeric id', async () => {
    const { showAction } = await import('../show.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(showAction('notanumber', {})).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when neither conversation nor session matches the id', async () => {
    const { showAction } = await import('../show.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(showAction('9999', {})).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('falls back to discovered-session index when no conversation matches', async () => {
    const session = await seedSession();
    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await showAction(String(session.id), {});

    const output = logs.join('\n');
    // Fallback namespace is a raw session, not a conversation.
    expect(output).toContain(`Session #${session.id}`);
    expect(output).not.toContain('Conversation #');
    expect(output).toContain('/fake/show-test.jsonl');
  });

  it('emits session-scoped JSON with source=session on fallback', async () => {
    const session = await seedSession();
    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));

    await showAction(String(session.id), { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.source).toBe('session');
    expect(parsed.id).toBe(session.id);
    // Session fields moved under `session` (no top-level jsonlPath anymore).
    expect(parsed.session.jsonlPath).toBe('/fake/show-test.jsonl');
    expect(parsed.session.messageCount).toBe(10);
  });

  // ── PAN-2018: conversation-first resolution ────────────────────────────────
  it('resolves via conversation first and bridges to its discovered session', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { resolveConversationTranscript } = await import(
      '../../../../lib/conversations/transcript-path.js'
    );

    const cwd = '/home/user/Projects/myapp';
    const claudeSessionId = '11111111-2222-3333-4444-555555555555';
    const transcript = resolveConversationTranscript(cwd, claudeSessionId);
    expect(transcript.path).toBeTruthy();

    // Seed the discovered session at exactly the path the resolver derives.
    await seedSession({ jsonlPath: transcript.path, messageCount: 42 });

    const conv = createConversation({
      name: '20260620-1699',
      tmuxSession: 'conv-20260620-1699',
      cwd,
      claudeSessionId,
      model: 'claude-opus-4-8',
      title: 'Auto-memory: file-based persistence',
      harness: 'claude-code',
    });

    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await showAction(String(conv.id), {});

    const output = logs.join('\n');
    expect(output).toContain(`Conversation #${conv.id}`);
    expect(output).toContain('Auto-memory: file-based persistence');
    expect(output).toContain('claude-opus-4-8');
    // Bridged session-derived data.
    expect(output).toContain(transcript.path!);
    expect(output).toContain('42'); // message count from the discovered session
  });

  it('shows conversation fields with no discovered session when transcript was never scanned', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');

    const conv = createConversation({
      name: '20260620-1700',
      tmuxSession: 'conv-20260620-1700',
      cwd: '/home/user/Projects/other',
      claudeSessionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
      model: 'glm-5.2',
      title: 'A conversation with no scanned session',
      harness: 'pi',
    });

    const { showAction } = await import('../show.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await showAction(String(conv.id), { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.source).toBe('conversation');
    expect(parsed.id).toBe(conv.id);
    expect(parsed.conversation.title).toBe('A conversation with no scanned session');
    expect(parsed.conversation.model).toBe('glm-5.2');
    expect(parsed.conversation.harness).toBe('pi');
    // No bridged session row exists.
    expect(parsed.session).toBeNull();
  });
});

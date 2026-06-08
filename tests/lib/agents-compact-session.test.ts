/**
 * PAN-1675: compactAgentSession — out-of-band Panopticon-side compaction of a
 * work agent's JSONL session. Verifies it resolves the SAME session file the
 * harness resumes from, calls compactConversationNative WITHOUT a
 * conversationName, never throws, and short-circuits when sessionId/workspace
 * are missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockCompactConversationNative = vi.fn();

vi.mock('../../src/dashboard/server/services/conversation-compaction.js', () => ({
  compactConversationNative: (...args: unknown[]) => mockCompactConversationNative(...args),
}));

let HOME_DIR: string;
const AGENT_ID = 'agent-pan-test';
const WORKSPACE = '/tmp/ws-pan-test';
const SESSION_ID = 'sess-abc-123';

function writeAgent(opts: { workspace?: string; sessionId?: string }): void {
  const agentDir = join(HOME_DIR, 'agents', AGENT_ID);
  mkdirSync(agentDir, { recursive: true });
  const state: Record<string, unknown> = {
    id: AGENT_ID,
    issueId: 'PAN-TEST',
    status: 'stopped',
    role: 'work',
    model: 'gpt-5.5',
  };
  if (opts.workspace) state.workspace = opts.workspace;
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state));
  if (opts.sessionId) writeFileSync(join(agentDir, 'session.id'), opts.sessionId);
}

beforeEach(() => {
  vi.resetModules();
  mockCompactConversationNative.mockReset().mockResolvedValue({
    summary: 's',
    tokensBefore: 1,
    boundaryUuid: 'b',
    model: 'm',
  });
  HOME_DIR = join(tmpdir(), `pan-compact-session-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(HOME_DIR, { recursive: true });
  process.env.PANOPTICON_HOME = HOME_DIR;
});

afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  delete process.env.PANOPTICON_HOME;
});

describe('compactAgentSession (PAN-1675)', () => {
  it('resolves the agent JSONL and calls compactConversationNative with no conversationName', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    const { compactAgentSession } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await compactAgentSession(AGENT_ID);

    expect(result).toEqual({ compacted: true });
    expect(mockCompactConversationNative).toHaveBeenCalledTimes(1);
    expect(mockCompactConversationNative).toHaveBeenCalledWith(sessionFilePath(WORKSPACE, SESSION_ID));
    // Exactly one argument — never a conversationName (which would flip the
    // dashboard 'compacting' event for a user conversation that isn't this one).
    expect(mockCompactConversationNative.mock.calls[0]).toHaveLength(1);
  });

  it('returns { compacted:false, error } without throwing when compaction rejects', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockCompactConversationNative.mockRejectedValue(new Error('boom'));
    const { compactAgentSession } = await import('../../src/lib/agents.js');

    const result = await compactAgentSession(AGENT_ID);

    expect(result.compacted).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('short-circuits to { compacted:false } with no compaction call when sessionId is missing', async () => {
    writeAgent({ workspace: WORKSPACE }); // no session.id
    const { compactAgentSession } = await import('../../src/lib/agents.js');

    const result = await compactAgentSession(AGENT_ID);

    expect(result).toEqual({ compacted: false });
    expect(mockCompactConversationNative).not.toHaveBeenCalled();
  });

  it('short-circuits to { compacted:false } with no compaction call when workspace is missing', async () => {
    writeAgent({ sessionId: SESSION_ID }); // no workspace
    const { compactAgentSession } = await import('../../src/lib/agents.js');

    const result = await compactAgentSession(AGENT_ID);

    expect(result).toEqual({ compacted: false });
    expect(mockCompactConversationNative).not.toHaveBeenCalled();
  });
});

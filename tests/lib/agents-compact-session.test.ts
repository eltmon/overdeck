/**
 * PAN-1781: buildCompactRecoverySeed — out-of-band summary + durable-artifact
 * seed for a fresh session replacing a context-wedged work agent. Verifies it
 * resolves the SAME JSONL session the harness would resume from, never mutates
 * that JSONL, degrades through fallback summary, and still returns a usable seed
 * when sessionId/workspace are missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';

const mockGetConversationCompactionSettings = vi.fn();
const mockGenerateSmartSummary = vi.fn();
const mockGenerateFallbackSummary = vi.fn();

vi.mock('../../src/dashboard/server/services/conversation-compaction.js', () => ({
  getConversationCompactionSettings: (...args: unknown[]) => mockGetConversationCompactionSettings(...args),
}));

vi.mock('../../src/lib/conversations/smart-compaction.js', () => ({
  generateSmartSummary: (...args: unknown[]) => mockGenerateSmartSummary(...args),
}));

vi.mock('../../src/lib/conversations/summary-fork.js', () => ({
  generateFallbackSummary: (...args: unknown[]) => mockGenerateFallbackSummary(...args),
}));

let HOME_DIR: string;
const AGENT_ID = 'agent-pan-test';
const ISSUE_ID = 'PAN-TEST';
const WORKSPACE = '/tmp/ws-pan-test';
const SESSION_ID = 'sess-abc-123';

function writeAgent(opts: { workspace?: string; sessionId?: string }): void {
  const agentDir = join(HOME_DIR, 'agents', AGENT_ID);
  mkdirSync(agentDir, { recursive: true });
  const state: Record<string, unknown> = {
    id: AGENT_ID,
    issueId: ISSUE_ID,
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
  mockGetConversationCompactionSettings.mockReset().mockReturnValue({
    model: 'claude-opus-4-7',
    richCompaction: true,
  });
  mockGenerateSmartSummary.mockReset().mockReturnValue(Effect.succeed({ summary: 'smart summary' }));
  mockGenerateFallbackSummary.mockReset().mockReturnValue(Effect.succeed('fallback summary'));
  HOME_DIR = join(tmpdir(), `pan-compact-seed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(HOME_DIR, { recursive: true });
  process.env.PANOPTICON_HOME = HOME_DIR;
});

afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  delete process.env.PANOPTICON_HOME;
});

describe('buildCompactRecoverySeed (PAN-1781)', () => {
  it('resolves the agent JSONL and embeds the smart summary in the fresh-session seed', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result).toEqual({
      summarized: true,
      seed: expect.stringContaining('smart summary'),
    });
    expect(result.seed).toContain(ISSUE_ID);
    expect(result.seed).toContain('Do NOT start over');
    expect(mockGenerateSmartSummary).toHaveBeenCalledWith({
      jsonlPath: sessionFilePath(WORKSPACE, SESSION_ID),
      model: 'claude-opus-4-7',
      richMode: true,
      mode: 'fork',
    });
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('uses the fallback summary when smart summarization rejects', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(true);
    expect(result.seed).toContain('fallback summary');
    expect(mockGenerateFallbackSummary).toHaveBeenCalledWith(sessionFilePath(WORKSPACE, SESSION_ID));
  });

  it('returns a durable-artifact-only seed when both summarizers fail', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('smart boom')));
    mockGenerateFallbackSummary.mockReturnValue(Effect.fail(new Error('fallback boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(result.seed).toContain('bd ready');
    expect(result.seed).toContain('git status');
    expect(result.seed).toContain('git diff');
    expect(result.seed).not.toContain('Summary of the archived session');
  });

  it('short-circuits to a durable-artifact-only seed when sessionId is missing', async () => {
    writeAgent({ workspace: WORKSPACE });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('short-circuits to a durable-artifact-only seed when workspace is missing', async () => {
    writeAgent({ sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });
});

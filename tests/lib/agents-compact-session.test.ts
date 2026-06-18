/**
 * PAN-1781: buildCompactRecoverySeed — out-of-band summary plus fresh-session
 * reseed prompt for a context-wedged work agent. Verifies it resolves the SAME
 * session file the harness would have resumed from, never throws, and
 * short-circuits to durable-artifact reconstruction when sessionId/workspace are
 * missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';

const mockGenerateSmartSummary = vi.fn();
const mockGenerateFallbackSummary = vi.fn();

vi.mock('../../src/dashboard/server/services/conversation-compaction.js', () => ({
  getConversationCompactionSettings: () => ({ model: 'summary-model', richCompaction: true }),
}));

vi.mock('../../src/lib/conversations/smart-compaction.js', () => ({
  generateSmartSummary: (...args: unknown[]) => mockGenerateSmartSummary(...args),
}));

vi.mock('../../src/lib/conversations/summary-fork.js', () => ({
  generateFallbackSummary: (...args: unknown[]) => mockGenerateFallbackSummary(...args),
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
  mockGenerateSmartSummary.mockReset().mockReturnValue(Effect.succeed({
    summary: 'Recovered session summary',
    tokensBefore: 1,
    boundaryUuid: 'b',
    model: 'm',
  }));
  mockGenerateFallbackSummary.mockReset().mockReturnValue(Effect.succeed('Fallback session summary'));
  HOME_DIR = join(tmpdir(), `pan-compact-session-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(HOME_DIR, { recursive: true });
  process.env.OVERDECK_HOME = HOME_DIR;
});

afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('buildCompactRecoverySeed (PAN-1781)', () => {
  it('resolves the agent JSONL and embeds a smart summary in the fresh-session seed', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result).toEqual({
      summarized: true,
      seed: expect.stringContaining('Recovered session summary'),
    });
    expect(result.seed).toContain('PAN-TEST');
    expect(result.seed).toContain('Do NOT start over');
    expect(mockGenerateSmartSummary).toHaveBeenCalledTimes(1);
    expect(mockGenerateSmartSummary).toHaveBeenCalledWith({
      jsonlPath: sessionFilePath(WORKSPACE, SESSION_ID),
      model: 'summary-model',
      richMode: true,
      mode: 'fork',
    });
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('falls back to a heuristic summary when smart summary generation rejects', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(true);
    expect(result.seed).toContain('Fallback session summary');
    expect(mockGenerateFallbackSummary).toHaveBeenCalledWith(sessionFilePath(WORKSPACE, SESSION_ID));
  });

  it('returns a reseed-only prompt without throwing when both summary paths fail', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('boom')));
    mockGenerateFallbackSummary.mockReturnValue(Effect.fail(new Error('fallback boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(result.seed).toContain('bd ready');
    expect(result.seed).toContain('Do NOT start over');
  });

  it('short-circuits to a reseed-only prompt with no summary call when sessionId is missing', async () => {
    writeAgent({ workspace: WORKSPACE }); // no session.id
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('short-circuits to a reseed-only prompt with no summary call when workspace is missing', async () => {
    writeAgent({ sessionId: SESSION_ID }); // no workspace
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('.pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });
});

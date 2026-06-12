/**
 * PAN-1781: buildCompactRecoverySeed — out-of-band Panopticon-side compact
 * recovery for a work agent. Verifies it resolves the same session file the
 * harness would have resumed from, embeds a summary in a fresh-session seed,
 * falls back without throwing, and short-circuits when sessionId/workspace are
 * missing.
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
  mockGetConversationCompactionSettings.mockReset().mockReturnValue({
    model: 'summary-model',
    richCompaction: true,
  });
  mockGenerateSmartSummary.mockReset().mockReturnValue(Effect.succeed({
    summary: 'smart summary of archived work',
    tokensBefore: 10,
    firstKeptEntryIndex: 1,
    summaryModel: 'summary-model',
    readFiles: [],
    modifiedFiles: [],
  }));
  mockGenerateFallbackSummary.mockReset().mockReturnValue(Effect.succeed('fallback summary of archived work'));
  HOME_DIR = join(tmpdir(), `pan-compact-recovery-seed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(HOME_DIR, { recursive: true });
  process.env.PANOPTICON_HOME = HOME_DIR;
});

afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  delete process.env.PANOPTICON_HOME;
});

describe('buildCompactRecoverySeed (PAN-1781)', () => {
  it('resolves the agent JSONL and embeds the smart summary in a fresh-session seed', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(true);
    expect(result.seed).toContain('Your previous session for PAN-TEST hit the model');
    expect(result.seed).toContain('Summary of the archived session:');
    expect(result.seed).toContain('smart summary of archived work');
    expect(result.seed).toContain('Read .pan/continue.json');
    expect(mockGenerateSmartSummary).toHaveBeenCalledTimes(1);
    expect(mockGenerateSmartSummary).toHaveBeenCalledWith({
      jsonlPath: sessionFilePath(WORKSPACE, SESSION_ID),
      model: 'summary-model',
      richMode: true,
      mode: 'fork',
    });
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('uses the heuristic fallback summary when smart summary generation rejects', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('smart summary boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(true);
    expect(result.seed).toContain('fallback summary of archived work');
    expect(mockGenerateFallbackSummary).toHaveBeenCalledTimes(1);
  });

  it('falls back to durable-artifact reconstruction when sessionId is missing', async () => {
    writeAgent({ workspace: WORKSPACE });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).not.toContain('Summary of the archived session:');
    expect(result.seed).toContain('Read .pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });

  it('falls back to durable-artifact reconstruction when workspace is missing', async () => {
    writeAgent({ sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).not.toContain('Summary of the archived session:');
    expect(result.seed).toContain('Read .pan/continue.json');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
    expect(mockGenerateFallbackSummary).not.toHaveBeenCalled();
  });
});

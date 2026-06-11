/**
 * PAN-1781: compact recovery now starts a fresh seeded session instead of
 * mutating the wedged JSONL in place. Verify the seed builder resolves the
 * same agent session file for summarization, falls back safely, and degrades
 * to durable-artifact reconstruction when state is incomplete.
 */
import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
let WORKSPACE: string;
const AGENT_ID = 'agent-pan-test';
const SESSION_ID = 'sess-abc-123';

function writeAgent(opts: { workspace?: string; sessionId?: string }): void {
  const agentDir = join(HOME_DIR, 'agents', AGENT_ID);
  mkdirSync(agentDir, { recursive: true });
  const state: Record<string, unknown> = {
    id: AGENT_ID,
    issueId: 'PAN-TEST',
    status: 'running',
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
    model: 'claude-haiku-4-5',
    richCompaction: true,
  });
  mockGenerateSmartSummary.mockReset().mockReturnValue(Effect.succeed({ summary: 'smart summary' }));
  mockGenerateFallbackSummary.mockReset().mockReturnValue(Effect.succeed('fallback summary'));
  HOME_DIR = join(tmpdir(), `pan-compact-seed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE = join(HOME_DIR, 'workspace');
  mkdirSync(WORKSPACE, { recursive: true });
  process.env.PANOPTICON_HOME = HOME_DIR;
});

afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  delete process.env.PANOPTICON_HOME;
});

describe('buildCompactRecoverySeed (PAN-1781)', () => {
  it('summarizes the agent JSONL with the configured compaction model', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(true);
    expect(result.seed).toContain('Your previous session for PAN-TEST hit the model');
    expect(result.seed).toContain('smart summary');
    expect(mockGenerateSmartSummary).toHaveBeenCalledWith({
      jsonlPath: sessionFilePath(WORKSPACE, SESSION_ID),
      model: 'claude-haiku-4-5',
      richMode: true,
      mode: 'fork',
    });
  });

  it('falls back to heuristic summary when smart summarization rejects', async () => {
    writeAgent({ workspace: WORKSPACE, sessionId: SESSION_ID });
    mockGenerateSmartSummary.mockReturnValue(Effect.fail(new Error('boom')));
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');
    const { sessionFilePath } = await import('../../src/lib/paths.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result).toMatchObject({ summarized: true });
    expect(result.seed).toContain('fallback summary');
    expect(mockGenerateFallbackSummary).toHaveBeenCalledWith(sessionFilePath(WORKSPACE, SESSION_ID));
  });

  it('degrades to durable-artifact reconstruction when sessionId is missing', async () => {
    writeAgent({ workspace: WORKSPACE });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('Read .pan/continue.json');
    expect(result.seed).toContain('bd ready');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
  });

  it('degrades to durable-artifact reconstruction when workspace is missing', async () => {
    writeAgent({ sessionId: SESSION_ID });
    const { buildCompactRecoverySeed } = await import('../../src/lib/agents.js');

    const result = await buildCompactRecoverySeed(AGENT_ID);

    expect(result.summarized).toBe(false);
    expect(result.seed).toContain('git status');
    expect(result.seed).toContain('git diff');
    expect(mockGenerateSmartSummary).not.toHaveBeenCalled();
  });
});

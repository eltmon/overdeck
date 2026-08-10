import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agents/agent-state.js';
import {
  COMPACTION_CONTINUE_COOLDOWN_MS,
  buildCompactionContinueMessage,
  continueCompactedAgentAfterHook,
  maybeContinueCompactedAgent,
  resetCompactionContinuationState,
  shouldContinueAfterCompaction,
  transcriptStalledAfterCompaction,
} from '../compaction-continuation.js';

const hasCompletionMarker = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../agents/supervisor-channels.js', () => ({
  hasCompletionMarkerForAgent: hasCompletionMarker,
}));

const IDLE_PANE = '  ⎿  Read review.md (56 lines)\n\n❯ \n';
const BUSY_PANE = '  ✻ Compacting conversation… (esc to interrupt)\n';

/**
 * The entries Claude Code writes after a manual `/compact`, in the order the
 * 2026-07-25 MIN-901 transcript recorded them: the boundary, the summary, the
 * command echo/stdout, the replayed file attachments, and the SessionStart hook.
 * None of them is a model turn.
 */
const BOUNDARY_LINE = JSON.stringify({
  type: 'system',
  subtype: 'compact_boundary',
  compactMetadata: { trigger: 'manual', preTokens: 186058, postTokens: 15804 },
});
const POST_COMPACT_BOOKKEEPING = [
  JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } }),
  JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat…</local-command-caveat>' } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name>' } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } }),
  JSON.stringify({ type: 'attachment', attachment: { type: 'file', filename: 'review.md' } }),
  JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', hookName: 'SessionStart:compact' } }),
];
/** Claude answering its own injected meta message — zero tokens, not work. */
const SYNTHETIC_ASSISTANT = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] },
});
const REAL_ASSISTANT_TURN = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', model: 'gpt-5.6-sol', content: [{ type: 'text', text: 'Continuing the review.' }] },
});

function agentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-min-901-review',
    issueId: 'MIN-901',
    workspace: '/tmp/ws',
    harness: 'claude-code',
    role: 'review',
    model: 'gpt-5.6-sol',
    status: 'running',
    sessionId: 'session-abc',
    ...overrides,
  } as AgentState;
}

describe('transcriptStalledAfterCompaction', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'compaction-continuation-'));
    file = join(dir, 'transcript.jsonl');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(lines: string[]): Promise<number> {
    const before = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'review MIN-901' } })}\n`;
    await writeFile(file, before + lines.map(l => `${l}\n`).join(''), 'utf-8');
    return Buffer.byteLength(before, 'utf-8');
  }

  it('reports a stall when only bookkeeping follows the compaction', async () => {
    const offset = await write([BOUNDARY_LINE, ...POST_COMPACT_BOOKKEEPING]);
    const verdict = await transcriptStalledAfterCompaction(file, async () => offset);
    expect(verdict.stalledAfterCompaction).toBe(true);
  });

  it('does not count a synthetic assistant entry as a model turn', async () => {
    const offset = await write([BOUNDARY_LINE, SYNTHETIC_ASSISTANT, ...POST_COMPACT_BOOKKEEPING]);
    const verdict = await transcriptStalledAfterCompaction(file, async () => offset);
    expect(verdict.stalledAfterCompaction).toBe(true);
  });

  it('clears the stall once a real model turn lands after the boundary', async () => {
    const offset = await write([BOUNDARY_LINE, ...POST_COMPACT_BOOKKEEPING, REAL_ASSISTANT_TURN]);
    const verdict = await transcriptStalledAfterCompaction(file, async () => offset);
    expect(verdict.stalledAfterCompaction).toBe(false);
  });

  it('stays out of the way when a fresh prompt is already pending', async () => {
    const prompt = JSON.stringify({ type: 'user', message: { role: 'user', content: 'continue please' } });
    const offset = await write([BOUNDARY_LINE, ...POST_COMPACT_BOOKKEEPING, prompt]);
    const verdict = await transcriptStalledAfterCompaction(file, async () => offset);
    expect(verdict.stalledAfterCompaction).toBe(false);
  });

  it('treats a transcript with no compaction as nothing to do', async () => {
    await write([REAL_ASSISTANT_TURN]);
    const verdict = await transcriptStalledAfterCompaction(file, async () => 0);
    expect(verdict.stalledAfterCompaction).toBe(false);
  });

  it('ignores a trailing partial line the agent is still writing', async () => {
    const before = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'review MIN-901' } })}\n`;
    const complete = [BOUNDARY_LINE, ...POST_COMPACT_BOOKKEEPING].map(l => `${l}\n`).join('');
    await writeFile(file, `${before}${complete}{"type":"assist`, 'utf-8');

    const verdict = await transcriptStalledAfterCompaction(file, async () => Buffer.byteLength(before, 'utf-8'));
    expect(verdict.stalledAfterCompaction).toBe(true);
  });
});

describe('shouldContinueAfterCompaction', () => {
  beforeEach(() => hasCompletionMarker.mockReturnValue(false));

  it('continues a running agent that still owes work', () => {
    expect(shouldContinueAfterCompaction(agentState()).ok).toBe(true);
  });

  it.each([
    ['paused', { paused: true }],
    ['troubled', { troubled: true }],
    ['stopped-by-user', { stoppedByUser: true }],
    ['not running', { status: 'stopped' as const }],
  ])('refuses to re-drive a %s agent', (_label, overrides) => {
    expect(shouldContinueAfterCompaction(agentState(overrides)).ok).toBe(false);
  });

  // PAN-2974: a handed-off agent told to "continue" re-ran verification and
  // fired review commands while the operator was mid-UAT.
  it('refuses to re-drive an agent whose work is already handed off', () => {
    hasCompletionMarker.mockReturnValue(true);
    const gate = shouldContinueAfterCompaction(agentState({ role: 'work' }));
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('handed-off');
  });
});

describe('maybeContinueCompactedAgent', () => {
  let dir: string;
  let file: string;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetCompactionContinuationState();
    hasCompletionMarker.mockReturnValue(false);
    dir = await mkdtemp(join(tmpdir(), 'compaction-continuation-'));
    file = join(dir, 'transcript.jsonl');
    await writeFile(file, `${[BOUNDARY_LINE, ...POST_COMPACT_BOOKKEEPING].map(l => `${l}\n`).join('')}`, 'utf-8');
    send = vi.fn(async () => undefined);
    vi.doMock('../../conversations/transcript-path.js', () => ({
      resolveConversationTranscript: () => ({ path: file, status: 'ok' }),
    }));
  });
  afterEach(async () => {
    vi.doUnmock('../../conversations/transcript-path.js');
    vi.resetModules();
    await rm(dir, { recursive: true, force: true });
  });

  async function run(overrides: Partial<AgentState> = {}, now = 1_000_000) {
    vi.resetModules();
    const mod = await import('../compaction-continuation.js');
    return mod.maybeContinueCompactedAgent({
      agentId: 'agent-min-901-review',
      tmuxOutput: IDLE_PANE,
      now,
      send,
      findBoundary: async () => 1,
      readState: () => agentState(overrides),
    });
  }

  it('nudges a compacted, idle agent', async () => {
    const action = await run();
    expect(action).toContain('agent-min-901-review');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toContain('compacted');
  });

  it('never nudges while the pane is still busy compacting', async () => {
    vi.resetModules();
    const mod = await import('../compaction-continuation.js');
    const action = await mod.maybeContinueCompactedAgent({
      agentId: 'agent-min-901-review',
      tmuxOutput: BUSY_PANE,
      now: 1_000_000,
      send,
      findBoundary: async () => 1,
      readState: () => agentState(),
    });
    expect(action).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not re-nudge inside the cooldown, and does again after it', async () => {
    vi.resetModules();
    const mod = await import('../compaction-continuation.js');
    const call = (now: number) => mod.maybeContinueCompactedAgent({
      agentId: 'agent-min-901-review',
      tmuxOutput: IDLE_PANE,
      now,
      send,
      findBoundary: async () => 1,
      readState: () => agentState(),
    });

    expect(await call(1_000_000)).not.toBeNull();
    expect(await call(1_000_000 + COMPACTION_CONTINUE_COOLDOWN_MS - 1)).toBeNull();
    expect(await call(1_000_000 + COMPACTION_CONTINUE_COOLDOWN_MS + 1)).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('continueCompactedAgentAfterHook', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the idle prompt and re-drives from the PostCompact event', async () => {
    vi.useFakeTimers();
    const capturePane = vi.fn()
      .mockResolvedValueOnce(BUSY_PANE)
      .mockResolvedValueOnce(IDLE_PANE);
    const continueAgent = vi.fn(async ({ tmuxOutput }: { tmuxOutput: string }) => (
      tmuxOutput.includes('❯') ? 'continued from hook' : null
    ));

    const result = continueCompactedAgentAfterHook({
      agentId: 'agent-min-901-review',
      capturePane,
      send: vi.fn(async () => undefined),
      findBoundary: vi.fn(async () => 1),
      readState: () => agentState(),
      continueAgent: continueAgent as typeof maybeContinueCompactedAgent,
      attempts: 2,
      intervalMs: 250,
    });

    await vi.waitFor(() => expect(capturePane).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe('continued from hook');
    expect(capturePane).toHaveBeenCalledTimes(2);
  });

  it('does not poll a gated agent after PostCompact', async () => {
    const capturePane = vi.fn(async () => IDLE_PANE);

    await expect(continueCompactedAgentAfterHook({
      agentId: 'agent-min-901-review',
      capturePane,
      send: vi.fn(async () => undefined),
      findBoundary: vi.fn(async () => 1),
      readState: () => agentState({ paused: true }),
    })).resolves.toBeNull();
    expect(capturePane).not.toHaveBeenCalled();
  });
});

describe('buildCompactionContinueMessage', () => {
  it('points a work agent at its xBRIEF item', () => {
    expect(buildCompactionContinueMessage(agentState({ role: 'work' }))).toContain('pan task show');
  });

  it('tells a non-work role to finish and signal through its lifecycle command', () => {
    const message = buildCompactionContinueMessage(agentState({ role: 'review' }));
    expect(message).toContain('lifecycle command');
    expect(message).not.toContain('pan task show');
  });

  it('never tells an agent to start over', () => {
    for (const role of ['work', 'review', 'test'] as const) {
      expect(buildCompactionContinueMessage(agentState({ role }))).toContain('Do not start over');
    }
  });
});

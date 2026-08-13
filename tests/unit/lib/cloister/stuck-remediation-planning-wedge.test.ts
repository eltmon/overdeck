import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  decidePlanningWedgeRemediation,
  executePlanningWedgeDecision,
  shouldClearPlanningWedgeEpisode,
  type PlanningWedgeEffectDeps,
} from '../../../../src/lib/cloister/stuck-remediation.js';
import {
  parseBackgroundTaskWedge,
  readAgentBackgroundTaskWedgeEvidence,
} from '../../../../src/lib/cloister/planning-wedge.js';
import { sessionFilePath } from '../../../../src/lib/paths.js';
import { DEFAULT_CLOISTER_CONFIG, type StuckRemediationConfig } from '../../../../src/lib/cloister/config.js';
import type { StuckRemediationState } from '../../../../src/lib/cloister/stuck-remediation-state.js';

// PAN-3677: planning sessions wedged mid-turn after background Explore children
// reached a terminal state (planning-min-888: one child failed at the
// 262,144-token model limit while its sibling finished; planning-min-889: both
// children finished). The parent hung on the provider call that followed,
// never regained its prompt, and queued `pan tell` messages went unprocessed;
// the manual kill + compact-recover lost conversation-only explorer notes.
//
// These tests lock the three layers of the fix:
//   1. parseBackgroundTaskWedge — the positive transcript signature, with
//      fixtures modeled on both real reproduction transcripts plus negative
//      fixtures (healthy long turn, child still running, unconsumed
//      notification, no background children).
//   2. decidePlanningWedgeRemediation — the bounded ladder and its guards.
//   3. executePlanningWedgeDecision — the side-effect contract (Escape BEFORE
//      one nudge; kill then resume the same session; state transitions).

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const CONFIG: StuckRemediationConfig = DEFAULT_CLOISTER_CONFIG.stuck_remediation!;
// Defaults: stage1 20min (interrupt-nudge), stage2 45min (kill-resume),
// stage3 90min (troubled).

// ─── JSONL fixture builders (shapes lifted from the real transcripts) ────────

function assistantToolUse(name: string, input: Record<string, unknown>) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } };
}

function toolResult(text: string) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text }] }] } };
}

function launchResult(taskId: string) {
  return toolResult(
    `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: ${taskId} (internal ID - do not share)`,
  );
}

function taskOutputResult(taskId: string, status: string) {
  return toolResult(
    `<retrieval_status>success</retrieval_status>\n<task_id>${taskId}</task_id>\n<task_type>local_agent</task_type>\n<status>${status}</status>\n<output>…findings…</output>`,
  );
}

function notification(taskId: string, status: string, operation: 'enqueue' | 'remove') {
  return {
    type: 'queue-operation',
    operation,
    content:
      `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>tool_abc</tool-use-id>\n` +
      `<output-file>/tmp/claude-1000/x/tasks/${taskId}.output</output-file>\n<status>${status}</status>\n` +
      (status === 'failed'
        ? `<summary>Agent "Explore fe" failed: Agent terminated early due to an API error: API Error: 400 Invalid request: Your request exceeded model token limit: 262144 (requested: 262517)</summary>\n`
        : `<summary>Agent "Explore api" finished</summary>\n`) +
      `<note>A task-notification fires each time this agent stops…</note>`,
  };
}

/** planning-min-889: two children, both collected via TaskOutput completed + notifications consumed; parent hung after. */
const MIN_889_ALL_FINISHED = [
  assistantToolUse('Agent', { description: 'Survey api', prompt: '…', run_in_background: true }),
  launchResult('a01c1262660ea8099'),
  assistantToolUse('Agent', { description: 'Survey fe', prompt: '…', run_in_background: true }),
  launchResult('ab104615fcf33cf73'),
  assistantToolUse('TaskOutput', { task_id: 'a01c1262660ea8099', block: true, timeout: 240000 }),
  notification('a01c1262660ea8099', 'completed', 'enqueue'),
  notification('a01c1262660ea8099', 'completed', 'remove'),
  taskOutputResult('a01c1262660ea8099', 'completed'),
  assistantToolUse('TaskOutput', { task_id: 'ab104615fcf33cf73', block: true, timeout: 300000 }),
  notification('ab104615fcf33cf73', 'completed', 'enqueue'),
  notification('ab104615fcf33cf73', 'completed', 'remove'),
  taskOutputResult('ab104615fcf33cf73', 'completed'),
  // ← the next assistant turn never arrived (hung provider call)
];

/** planning-min-888: frontend child failed at the 262,144-token model limit; API child finished 4min later; parent hung after. */
const MIN_888_FAILED_AND_FINISHED = [
  assistantToolUse('Agent', { description: 'Explore fe', prompt: '…', run_in_background: true }),
  launchResult('acbdbb3658fb851fc'),
  assistantToolUse('Agent', { description: 'Explore api', prompt: '…', run_in_background: true }),
  launchResult('ac49288baf430f996'),
  assistantToolUse('Bash', { command: 'ls …' }),
  toolResult('file1.ts file2.ts'),
  notification('acbdbb3658fb851fc', 'failed', 'enqueue'),
  notification('acbdbb3658fb851fc', 'failed', 'remove'),
  assistantToolUse('Bash', { command: 'grep …' }),
  toolResult('match.ts:1:x'),
  notification('ac49288baf430f996', 'completed', 'enqueue'),
  notification('ac49288baf430f996', 'completed', 'remove'),
  assistantToolUse('Bash', { command: 'head -40 docs/catalog.md' }),
  toolResult('# Catalog…'),
  // ← the next assistant turn never arrived (hung provider call)
];

describe('parseBackgroundTaskWedge (PAN-3677 transcript signature)', () => {
  it('proves the wedge when every background child finished successfully (MIN-889)', () => {
    const evidence = parseBackgroundTaskWedge(MIN_889_ALL_FINISHED);
    expect(evidence.launchedTaskIds).toEqual(['a01c1262660ea8099', 'ab104615fcf33cf73']);
    expect(evidence.terminalTaskIds).toEqual(['a01c1262660ea8099', 'ab104615fcf33cf73']);
    expect(evidence.nonTerminalTaskIds).toEqual([]);
    expect(evidence.wedged).toBe(true);
  });

  it('proves the wedge when one child failed on a model/API error and its sibling finished (MIN-888)', () => {
    const evidence = parseBackgroundTaskWedge(MIN_888_FAILED_AND_FINISHED);
    expect(evidence.wedged).toBe(true);
    expect(evidence.terminalTaskIds).toEqual(['acbdbb3658fb851fc', 'ac49288baf430f996']);
    expect(evidence.nonTerminalTaskIds).toEqual([]);
  });

  it('refuses while any child is still running (no terminal proof for it)', () => {
    const evidence = parseBackgroundTaskWedge([
      assistantToolUse('Agent', { description: 'a', prompt: '…', run_in_background: true }),
      launchResult('aaa111'),
      assistantToolUse('Agent', { description: 'b', prompt: '…', run_in_background: true }),
      launchResult('bbb222'),
      notification('aaa111', 'completed', 'enqueue'),
      notification('aaa111', 'completed', 'remove'),
      // bbb222 still exploring — no notification, no TaskOutput result
    ]);
    expect(evidence.terminalTaskIds).toEqual(['aaa111']);
    expect(evidence.nonTerminalTaskIds).toEqual(['bbb222']);
    expect(evidence.wedged).toBe(false);
  });

  it('refuses a healthy long turn with no background children at all', () => {
    const evidence = parseBackgroundTaskWedge([
      assistantToolUse('Read', { file_path: '/x.ts' }),
      toolResult('1 line'),
      assistantToolUse('Bash', { command: 'make' }),
      toolResult('ok'),
    ]);
    expect(evidence.launchedTaskIds).toEqual([]);
    expect(evidence.wedged).toBe(false);
  });

  it('treats a non-terminal TaskOutput result (still running) as NOT terminal', () => {
    const evidence = parseBackgroundTaskWedge([
      launchResult('aaa111'),
      taskOutputResult('aaa111', 'running'),
    ]);
    expect(evidence.wedged).toBe(false);
    expect(evidence.nonTerminalTaskIds).toEqual(['aaa111']);
  });

  it('marks a terminal-but-unconsumed notification (parent has not folded it in yet)', () => {
    const evidence = parseBackgroundTaskWedge([
      launchResult('aaa111'),
      notification('aaa111', 'completed', 'enqueue'),
    ]);
    expect(evidence.wedged).toBe(true);
    expect(evidence.unconsumedTerminalTaskIds).toEqual(['aaa111']);
  });

  it('ignores malformed entries instead of crashing', () => {
    const evidence = parseBackgroundTaskWedge([null, 42, 'junk', { type: 'queue-operation' }, ...MIN_889_ALL_FINISHED]);
    expect(evidence.wedged).toBe(true);
  });

  // ── Turn scoping: evidence resets at genuine prompt boundaries ────────────

  /** A consumed operator `pan tell` — the authoritative mid-session boundary (no user entry is written). */
  const consumedOperatorMessage = {
    type: 'queue-operation',
    operation: 'remove',
    content: 'Both exploration tasks are complete. Proceed now to write the complete PRD…',
  };
  /** A fresh user-string prompt (kickoff / recovery-resume seed shape). */
  const userPrompt = { type: 'user', message: { role: 'user', content: 'Continue planning from where you left off.' } };

  it('does not let a historic all-terminal batch poison a later healthy turn (consumed operator prompt resets)', () => {
    // Old batch finished, operator replied, then a healthy long reasoning turn
    // with ordinary tool calls and NO new launches — wedged must be false even
    // though the transcript still contains a fully-terminal explorer batch.
    const evidence = parseBackgroundTaskWedge([
      ...MIN_889_ALL_FINISHED,
      consumedOperatorMessage,
      assistantToolUse('Read', { file_path: '/x.ts' }),
      toolResult('1 line'),
      assistantToolUse('Bash', { command: 'make' }),
      toolResult('ok'),
    ]);
    expect(evidence.launchedTaskIds).toEqual([]);
    expect(evidence.wedged).toBe(false);
  });

  it('resets on a user-string prompt boundary too (recovery-resume seed shape)', () => {
    const evidence = parseBackgroundTaskWedge([...MIN_888_FAILED_AND_FINISHED, userPrompt]);
    expect(evidence.launchedTaskIds).toEqual([]);
    expect(evidence.wedged).toBe(false);
  });

  it('does not treat tool_result user messages as prompt boundaries', () => {
    // MIN-888 interleaves Bash tool_results between launches and terminal
    // notifications; if those reset evidence, the wedge would never prove.
    const evidence = parseBackgroundTaskWedge(MIN_888_FAILED_AND_FINISHED);
    expect(evidence.wedged).toBe(true);
  });

  it('scopes an active child to the CURRENT turn after a boundary', () => {
    // After the operator's message the planner launched two fresh explorers;
    // one finished, one is still running — no interrupt, even though the
    // transcript holds an older all-terminal batch.
    const evidence = parseBackgroundTaskWedge([
      ...MIN_889_ALL_FINISHED,
      consumedOperatorMessage,
      assistantToolUse('Agent', { description: 'c', prompt: '…', run_in_background: true }),
      launchResult('ccc333'),
      assistantToolUse('Agent', { description: 'd', prompt: '…', run_in_background: true }),
      launchResult('ddd444'),
      notification('ccc333', 'completed', 'enqueue'),
      notification('ccc333', 'completed', 'remove'),
    ]);
    expect(evidence.terminalTaskIds).toEqual(['ccc333']);
    expect(evidence.nonTerminalTaskIds).toEqual(['ddd444']);
    expect(evidence.wedged).toBe(false);
  });
});

// ─── Redacted real-incident fixtures ─────────────────────────────────────────
// tests/fixtures/pan-3677/*.jsonl preserve the exact entry shapes, XML tags,
// and event ordering of the two incident transcripts (see the fixture README).

function readFixture(name: string): unknown[] {
  const raw = readFileSync(fileURLToPath(new URL(`../../../fixtures/pan-3677/${name}`, import.meta.url)), 'utf-8');
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe('parseBackgroundTaskWedge against the redacted incident transcripts', () => {
  it('proves the wedge in the MIN-889 all-finished incident', () => {
    const evidence = parseBackgroundTaskWedge(readFixture('min-889-all-finished.jsonl'));
    expect(evidence.launchedTaskIds).toEqual(['cafe0000000000001', 'cafe0000000000002']);
    expect(evidence.nonTerminalTaskIds).toEqual([]);
    expect(evidence.wedged).toBe(true);
  });

  it('proves the wedge in the MIN-888 failed+finished incident, carrying the still-running child across the mid-exploration operator message', () => {
    const evidence = parseBackgroundTaskWedge(readFixture('min-888-failed-and-finished.jsonl'));
    // The failed child was retired at the operator-message boundary; the API
    // explorer was still running then and carried across it.
    expect(evidence.launchedTaskIds).toEqual(['dead0000000000002']);
    expect(evidence.terminalTaskIds).toEqual(['dead0000000000002']);
    expect(evidence.wedged).toBe(true);
  });
});

// ─── Production session-path resolver ───────────────────────────────────────

describe('readAgentBackgroundTaskWedgeEvidence (PAN-3677)', () => {
  let overdeckHome: string;
  let fakeHome: string;
  let prevOverdeckHome: string | undefined;
  let prevHome: string | undefined;

  beforeEach(() => {
    overdeckHome = mkdtempSync(join(tmpdir(), 'pan-wedge-od-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'pan-wedge-home-'));
    prevOverdeckHome = process.env.OVERDECK_HOME;
    prevHome = process.env.HOME;
    process.env.OVERDECK_HOME = overdeckHome;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(overdeckHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('resolves the agent\'s current session id and parses that JSONL', () => {
    const agentId = 'planning-test-1';
    const workspace = join(fakeHome, 'ws');
    const sessionId = 'sess-abc-123';
    // The production pointer: <OVERDECK_HOME>/agents/<id>/session.id
    mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', agentId, 'session.id'), sessionId);
    // The production transcript path: ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
    const transcriptPath = sessionFilePath(workspace, sessionId);
    expect(transcriptPath.startsWith(join(fakeHome, '.claude', 'projects'))).toBe(true);
    mkdirSync(dirname(transcriptPath), { recursive: true });
    const lines = MIN_889_ALL_FINISHED.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(transcriptPath, lines);

    const evidence = readAgentBackgroundTaskWedgeEvidence(agentId, workspace);
    expect(evidence).not.toBeNull();
    expect(evidence?.wedged).toBe(true);
    expect(evidence?.launchedTaskIds).toEqual(['a01c1262660ea8099', 'ab104615fcf33cf73']);
  });

  it('returns null (not proven) when the agent has no session pointer or no transcript', () => {
    expect(readAgentBackgroundTaskWedgeEvidence('planning-missing', join(fakeHome, 'ws'))).toBeNull();
    const agentId = 'planning-test-2';
    mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', agentId, 'session.id'), 'sess-no-transcript');
    expect(readAgentBackgroundTaskWedgeEvidence(agentId, join(fakeHome, 'ws'))).toBeNull();
  });
});

// ─── Ladder decision ─────────────────────────────────────────────────────────

function decide(over: Partial<Parameters<typeof decidePlanningWedgeRemediation>[0]>) {
  return decidePlanningWedgeRemediation({
    mirrorState: 'active',
    pendingQuestions: 0,
    wedgeProven: true,
    workActivityMs: NOW - 30 * MIN,
    lastStage: 0,
    now: NOW,
    config: CONFIG,
    ...over,
  });
}

describe('decidePlanningWedgeRemediation (PAN-3677)', () => {
  it('interrupts a transcript-proven wedge after every background child is terminal', () => {
    expect(decide({ workActivityMs: NOW - 30 * MIN })).toEqual({ kind: 'interrupt-nudge', idleMinutes: 30 });
  });

  it('refuses without the positive transcript proof even when mirror and timing match', () => {
    // A healthy long reasoning/provider turn is mirror-'active' and silent —
    // identical to a wedge on those two signals. Only the transcript proof
    // separates them.
    expect(decide({ wedgeProven: false })).toEqual({ kind: 'none' });
    expect(decide({ wedgeProven: false, workActivityMs: NOW - 300 * MIN })).toEqual({ kind: 'none' });
  });

  it('escalates to kill-resume (transcript-preserving) when the interrupt did not un-wedge it', () => {
    expect(decide({ workActivityMs: NOW - 60 * MIN, lastStage: 1 })).toEqual({ kind: 'kill-resume', idleMinutes: 60 });
  });

  it('terminates at troubled — no stage of the ladder waits unbounded', () => {
    expect(decide({ workActivityMs: NOW - 120 * MIN, lastStage: 2 })).toEqual({ kind: 'troubled', idleMinutes: 120 });
    // Past stage 3 the episode is done: nothing further fires.
    expect(decide({ workActivityMs: NOW - 300 * MIN, lastStage: 3 })).toEqual({ kind: 'none' });
  });

  it('never interrupts while work activity is fresh', () => {
    expect(decide({ workActivityMs: NOW - 2 * MIN })).toEqual({ kind: 'none' });
    expect(decide({ workActivityMs: NOW - (CONFIG.stage1_minutes - 1) * MIN })).toEqual({ kind: 'none' });
  });

  it('never interrupts a session at its prompt (mirror idle — Stop hook fired)', () => {
    expect(decide({ mirrorState: 'idle', workActivityMs: NOW - 300 * MIN })).toEqual({ kind: 'none' });
  });

  it('never interrupts while an AskUserQuestion is pending', () => {
    expect(decide({ pendingQuestions: 1, workActivityMs: NOW - 300 * MIN })).toEqual({ kind: 'none' });
  });

  it('does not act without a mirror or without any work-activity signal', () => {
    expect(decide({ mirrorState: null })).toEqual({ kind: 'none' });
    expect(decide({ workActivityMs: null })).toEqual({ kind: 'none' });
    for (const s of ['suspended', 'stopped', 'waiting-on-human', 'uninitialized']) {
      expect(decide({ mirrorState: s, workActivityMs: NOW - 300 * MIN })).toEqual({ kind: 'none' });
    }
  });

  it('does not re-fire a stage already taken this episode', () => {
    expect(decide({ workActivityMs: NOW - 30 * MIN, lastStage: 1 })).toEqual({ kind: 'none' });
    expect(decide({ workActivityMs: NOW - 60 * MIN, lastStage: 2 })).toEqual({ kind: 'none' });
    // Crossing the NEXT threshold with a lower lastStage still escalates.
    expect(decide({ workActivityMs: NOW - 100 * MIN, lastStage: 1 })).toEqual({ kind: 'troubled', idleMinutes: 100 });
  });
});

// ─── Episode clear ───────────────────────────────────────────────────────────

describe('shouldClearPlanningWedgeEpisode (PAN-3677)', () => {
  const episode = (firstStuckAt: number): StuckRemediationState => ({
    lastStage: 1,
    lastStageAt: new Date(firstStuckAt).toISOString(),
    firstStuckAt: new Date(firstStuckAt).toISOString(),
  });

  it('clears once work resumes after the episode opened', () => {
    expect(shouldClearPlanningWedgeEpisode(episode(NOW - 30 * MIN), NOW - 1 * MIN)).toBe(true);
  });

  it('holds while work activity stays at or before the episode start', () => {
    expect(shouldClearPlanningWedgeEpisode(episode(NOW - 30 * MIN), NOW - 30 * MIN)).toBe(false);
    expect(shouldClearPlanningWedgeEpisode(episode(NOW - 30 * MIN), NOW - 60 * MIN)).toBe(false);
  });

  it('never clears without an open episode', () => {
    expect(shouldClearPlanningWedgeEpisode(null, NOW)).toBe(false);
  });
});

// ─── Side-effect executor ────────────────────────────────────────────────────

function makeDeps() {
  const calls: Array<[string, ...unknown[]]> = [];
  const deps: PlanningWedgeEffectDeps = {
    sendEscape: async (id) => { calls.push(['sendEscape', id]); },
    message: async (id, msg) => { calls.push(['message', id, msg]); },
    killSession: async (id) => { calls.push(['killSession', id]); },
    resume: async (id, msg) => { calls.push(['resume', id, msg]); return { success: true }; },
    markTroubled: (id) => { calls.push(['markTroubled', id]); },
    writeState: (id, state) => { calls.push(['writeState', id, state]); },
    surfaceNeedsYou: async () => { calls.push(['surfaceNeedsYou']); },
    log: (msg) => { calls.push(['log', msg]); },
  };
  return { calls, deps };
}

const FIRST_STUCK = new Date(NOW - 30 * MIN).toISOString();

describe('executePlanningWedgeDecision (PAN-3677)', () => {
  it('stage 1 sends Escape BEFORE queueing exactly one nudge, then records stage 1', async () => {
    const { calls, deps } = makeDeps();
    await executePlanningWedgeDecision('planning-min-889', 'MIN-889', { kind: 'interrupt-nudge', idleMinutes: 30 }, FIRST_STUCK, NOW, deps);
    const kinds = calls.map((c) => c[0]);
    expect(kinds).toEqual(['sendEscape', 'message', 'writeState', 'log']);
    expect(calls[0]?.[1]).toBe('planning-min-889');
    expect(calls[1]?.[1]).toBe('planning-min-889');
    expect(String(calls[1]?.[2])).toContain('interrupted');
    expect((calls[2]?.[2] as StuckRemediationState).lastStage).toBe(1);
  });

  it('stage 1 abandons the nudge when the interrupt itself fails', async () => {
    const { calls, deps } = makeDeps();
    deps.sendEscape = async () => { throw new Error('tmux gone'); };
    await executePlanningWedgeDecision('planning-min-889', 'MIN-889', { kind: 'interrupt-nudge', idleMinutes: 30 }, FIRST_STUCK, NOW, deps);
    expect(calls.map((c) => c[0])).toEqual([]); // no state write → the ladder retries next tick
  });

  it('stage 1 still records the stage when the nudge throws after a successful Escape — a later tick must not re-Escape', async () => {
    const { calls, deps } = makeDeps();
    deps.message = async (id, msg) => { calls.push(['message', id, msg]); throw new Error('delivery door closed'); };
    await executePlanningWedgeDecision('planning-min-889', 'MIN-889', { kind: 'interrupt-nudge', idleMinutes: 30 }, FIRST_STUCK, NOW, deps);
    const kinds = calls.map((c) => c[0]);
    // Escape landed, nudge failed, but the stage is recorded and the failure logged.
    expect(kinds).toEqual(['sendEscape', 'message', 'writeState', 'log']);
    expect((calls[2]?.[2] as StuckRemediationState).lastStage).toBe(1);
    expect(String(calls[3]?.[1])).toContain('nudge delivery failed');
    expect(String(calls[3]?.[1])).toContain('delivery door closed');
    // The recorded stage-1 state closes the loop: the decision fed by that
    // state on the next patrol does not repeat the interrupt.
    const next = decidePlanningWedgeRemediation({
      mirrorState: 'active',
      pendingQuestions: 0,
      wedgeProven: true,
      workActivityMs: NOW - 30 * MIN,
      lastStage: (calls[2]?.[2] as StuckRemediationState).lastStage,
      now: NOW,
      config: CONFIG,
    });
    expect(next).toEqual({ kind: 'none' });
  });

  it('stage 2 kills the session and resumes the same agent, then records stage 2', async () => {
    const { calls, deps } = makeDeps();
    await executePlanningWedgeDecision('planning-min-888', 'MIN-888', { kind: 'kill-resume', idleMinutes: 60 }, FIRST_STUCK, NOW, deps);
    const kinds = calls.map((c) => c[0]);
    expect(kinds).toEqual(['killSession', 'resume', 'writeState', 'log']);
    expect(calls[0]?.[1]).toBe('planning-min-888');
    expect(calls[1]?.[1]).toBe('planning-min-888'); // same session — transcript preserved
    expect(String(calls[1]?.[2])).toContain('transcript is intact');
    expect((calls[2]?.[2] as StuckRemediationState).lastStage).toBe(2);
  });

  it('stage 2 marks troubled + needs-you when the resume fails', async () => {
    const { calls, deps } = makeDeps();
    deps.resume = async (id, msg) => { calls.push(['resume', id, msg]); return { success: false, error: 'no resumable session id' }; };
    await executePlanningWedgeDecision('planning-min-888', 'MIN-888', { kind: 'kill-resume', idleMinutes: 60 }, FIRST_STUCK, NOW, deps);
    const kinds = calls.map((c) => c[0]);
    expect(kinds).toEqual(['killSession', 'resume', 'markTroubled', 'writeState', 'log', 'surfaceNeedsYou']);
    expect((calls[3]?.[2] as StuckRemediationState).lastStage).toBe(3);
  });

  it('stage 2 awaits the async kill before resuming, and still resumes when the kill fails', async () => {
    const { calls, deps } = makeDeps();
    // Manually deferred kill — no timers. resume must not run while the kill
    // promise is pending.
    let resolveKill!: () => void;
    const killGate = new Promise<void>((resolve) => { resolveKill = resolve; });
    deps.killSession = async (id) => { calls.push(['killSession', id]); await killGate; };
    deps.resume = async (id, msg) => { calls.push(['resume', id, msg]); return { success: true }; };
    const run = executePlanningWedgeDecision('planning-min-888', 'MIN-888', { kind: 'kill-resume', idleMinutes: 60 }, FIRST_STUCK, NOW, deps);
    await Promise.resolve();
    expect(calls.map((c) => c[0])).toEqual(['killSession']); // resume has not run — the kill is still pending
    resolveKill();
    await run;
    expect(calls.map((c) => c[0])).toEqual(['killSession', 'resume', 'writeState', 'log']);

    const failed = makeDeps();
    failed.deps.killSession = async (id) => { failed.calls.push(['killSession', id]); throw new Error('session already gone'); };
    await executePlanningWedgeDecision('planning-min-888', 'MIN-888', { kind: 'kill-resume', idleMinutes: 60 }, FIRST_STUCK, NOW, failed.deps);
    expect(failed.calls.map((c) => c[0])).toEqual(['killSession', 'resume', 'writeState', 'log']);
  });

  it('stage 3 marks troubled + needs-you without touching the session', async () => {
    const { calls, deps } = makeDeps();
    await executePlanningWedgeDecision('planning-min-889', 'MIN-889', { kind: 'troubled', idleMinutes: 120 }, FIRST_STUCK, NOW, deps);
    const kinds = calls.map((c) => c[0]);
    expect(kinds).toEqual(['markTroubled', 'writeState', 'log', 'surfaceNeedsYou']);
  });
});

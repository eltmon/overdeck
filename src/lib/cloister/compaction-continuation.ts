/**
 * Continue an agent that compacted and then stopped (PAN-3057).
 *
 * A *manual* `/compact` ends the turn: Claude Code writes the summary, replays
 * the file reads, and drops to an idle prompt. Nothing re-drives it. That is
 * fine when Overdeck sent the `/compact` — `deliverOrchestratedCompact()`
 * registers the session and the patrol nudges it afterwards — but the harness
 * compacts on its own too. On 2026-07-25 a host restart resumed six MYN agents;
 * Claude Code classified each restored session as an interrupted turn and ran
 * `/compact` itself (`trigger: "manual"`, same promptId as its own resume
 * injection). All six then sat idle. Deacon never touched them: they were not
 * stopped, so `handleAgentStoppedEvent` skipped every one.
 *
 * The detector here is deliberately NOT "did Overdeck send a compact" — that is
 * the assumption that failed. It reads the fact from the transcript: a
 * `compact_boundary` with no model turn after it means the session compacted and
 * never resumed, whoever pressed the button. That signal is durable across a
 * dashboard restart (unlike the in-memory continuation map) and needs no new
 * event type, hook payload, or marker file.
 */

import { open, stat } from 'node:fs/promises';

import { getAgentStateSync, type AgentState } from '../agents/agent-state.js';
import { getAgentRuntimeStateSync } from '../agents/runtime-state.js';
import { hasCompletionMarkerForAgent } from '../agents/supervisor-channels.js';
import { resolveConversationTranscript } from '../conversations/transcript-path.js';

/** Re-nudge cooldown per agent, so an agent that ignores the nudge isn't spammed. */
export const COMPACTION_CONTINUE_COOLDOWN_MS = 10 * 60_000;

/**
 * Cap on the bytes scanned after the compact boundary. The tail holds the
 * summary plus replayed file attachments, so it can be large; we only need to
 * know whether a model turn happened, and that entry lands early.
 */
const MAX_TAIL_SCAN_BYTES = 4 * 1024 * 1024;

const lastContinuationAt = new Map<string, number>();
const postCompactContinuationInFlight = new Set<string>();

export function resetCompactionContinuationState(): void {
  lastContinuationAt.clear();
  postCompactContinuationInFlight.clear();
}

export interface CompactedIdleVerdict {
  /** True when the transcript's last compaction was never followed by a model turn. */
  stalledAfterCompaction: boolean;
  /** Byte offset of the boundary we judged, for logging. */
  boundaryOffset: number;
}

/**
 * Does this transcript end at a compaction that no model turn followed?
 *
 * "Model turn" means a real `assistant` entry. Claude Code writes synthetic
 * assistant entries (`model: "<synthetic>"`, zero tokens) for meta messages it
 * answers itself — those are not evidence the agent did anything. Everything
 * else Claude writes after a compaction (the summary user message, replayed file
 * attachments, hook results) is bookkeeping, not work.
 *
 * A non-meta user message after the boundary also counts as "someone already
 * prompted it": the agent is mid-turn or has just been nudged, so we stay out.
 */
export async function transcriptStalledAfterCompaction(
  transcriptPath: string,
  findBoundary: (path: string) => Promise<number>,
): Promise<CompactedIdleVerdict> {
  let boundaryOffset = 0;
  try {
    boundaryOffset = await findBoundary(transcriptPath);
  } catch {
    return { stalledAfterCompaction: false, boundaryOffset: 0 };
  }
  // Offset 0 means "no compaction in this transcript" (findLastCompactBoundary's
  // documented not-found value), not "compacted at the very first byte".
  if (boundaryOffset <= 0) return { stalledAfterCompaction: false, boundaryOffset: 0 };

  let size = 0;
  try {
    size = (await stat(transcriptPath)).size;
  } catch {
    return { stalledAfterCompaction: false, boundaryOffset };
  }
  if (size <= boundaryOffset) return { stalledAfterCompaction: true, boundaryOffset };

  const toRead = Math.min(size - boundaryOffset, MAX_TAIL_SCAN_BYTES);
  let tail = '';
  const fh = await open(transcriptPath, 'r').catch(() => null);
  if (!fh) return { stalledAfterCompaction: false, boundaryOffset };
  try {
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, boundaryOffset);
    tail = buf.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return { stalledAfterCompaction: false, boundaryOffset };
  } finally {
    await fh.close().catch(() => {});
  }

  // Drop a trailing partial line — the agent may be writing as we read.
  const lines = tail.split('\n');
  if (!tail.endsWith('\n')) lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry['type'];
    const message = entry['message'] as { role?: string; model?: string } | undefined;

    if (type === 'assistant') {
      // Synthetic entries are Claude answering its own meta message.
      if (message?.model && message.model !== '<synthetic>') {
        return { stalledAfterCompaction: false, boundaryOffset };
      }
      continue;
    }
    if (type === 'user' && entry['isMeta'] !== true && entry['isCompactSummary'] !== true) {
      const content = message?.role === 'user' ? (entry['message'] as { content?: unknown }).content : undefined;
      // `<local-command-stdout>` and the `/compact` command echo are the harness
      // narrating its own compaction, not a prompt someone sent the agent.
      const text = typeof content === 'string' ? content : '';
      if (!text.startsWith('<local-command-') && !text.startsWith('<command-')) {
        return { stalledAfterCompaction: false, boundaryOffset };
      }
    }
  }

  return { stalledAfterCompaction: true, boundaryOffset };
}

/**
 * Should this agent be re-driven at all?
 *
 * Mirrors `buildResumeContinueMessage`'s phase-awareness: an agent whose work is
 * already handed off (completed marker) must never be told to "continue" — that
 * is how PAN-2974 had a resumed agent re-run verification and fire review
 * commands while the operator was mid-UAT. Gated agents stay gated.
 */
export function shouldContinueAfterCompaction(state: AgentState): { ok: boolean; reason?: string } {
  if (state.paused === true) return { ok: false, reason: 'paused' };
  if (state.troubled === true) return { ok: false, reason: 'troubled' };
  if (state.stoppedByUser === true) return { ok: false, reason: 'stopped-by-user' };
  if (state.status !== 'running') return { ok: false, reason: `status=${state.status}` };
  if (hasCompletionMarkerForAgent(state)) return { ok: false, reason: 'handed-off (completed marker)' };
  return { ok: true };
}

export function buildCompactionContinueMessage(state: AgentState): string {
  const issueId = state.issueId;
  if (state.role === 'work') {
    return (
      `Your context was compacted and the turn ended, so you stopped mid-task on ${issueId}. `
      + 'Continue from the compacted summary now: re-read your current xBRIEF item '
      + '(`pan task show`) and your latest .pan/feedback/ file if you need them, then resume '
      + 'work. Do not start over and do not wait for further input.'
    );
  }
  return (
    `Your context was compacted and the turn ended, so you stopped mid-task on ${issueId}. `
    + 'Continue from the compacted summary now, finish the task you were on, and signal the '
    + 'result through your normal lifecycle command. Do not start over and do not wait for '
    + 'further input.'
  );
}

export interface ContinueCompactedAgentArgs {
  agentId: string;
  /** Live pane text; an idle prompt is required before we send anything. */
  tmuxOutput: string;
  now?: number;
  send: (agentId: string, message: string) => Promise<unknown>;
  findBoundary: (path: string) => Promise<number>;
  /** Injected for tests; defaults to the real agent-state read. */
  readState?: (agentId: string) => AgentState | null;
}

/**
 * Nudge an agent that compacted and stopped. Returns an action string when a
 * nudge was delivered, or null when nothing was owed.
 */
export async function maybeContinueCompactedAgent(
  args: ContinueCompactedAgentArgs,
): Promise<string | null> {
  const now = args.now ?? Date.now();
  const readState = args.readState ?? getAgentStateSync;

  if (!args.tmuxOutput.includes('❯')) return null;

  const last = lastContinuationAt.get(args.agentId);
  if (last !== undefined && now - last < COMPACTION_CONTINUE_COOLDOWN_MS) return null;

  const state = readState(args.agentId);
  if (!state) return null;

  const gate = shouldContinueAfterCompaction(state);
  if (!gate.ok) return null;

  // Same session resolution as maybeProactivelyCompactContext: agent state first,
  // runtime snapshot second — a recovered agent may only carry the runtime value.
  const sessionId = state.sessionId ?? getAgentRuntimeStateSync(args.agentId)?.claudeSessionId;
  if (!sessionId || !state.workspace) return null;
  const transcript = resolveConversationTranscript(state.workspace, sessionId);
  if (!transcript.path || transcript.status !== 'ok') return null;

  const verdict = await transcriptStalledAfterCompaction(transcript.path, args.findBoundary);
  if (!verdict.stalledAfterCompaction) return null;

  await args.send(args.agentId, buildCompactionContinueMessage(state));
  lastContinuationAt.set(args.agentId, now);
  return `Compaction continuation: nudged ${args.agentId} — compacted and idle with no turn after the boundary`;
}

const POST_COMPACT_PROMPT_POLL_INTERVAL_MS = 250;
const POST_COMPACT_PROMPT_POLL_ATTEMPTS = 20;

export interface ContinueAfterPostCompactHookArgs
  extends Omit<ContinueCompactedAgentArgs, 'tmuxOutput' | 'now'> {
  capturePane: (agentId: string) => Promise<string>;
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  continueAgent?: typeof maybeContinueCompactedAgent;
}

/**
 * Deterministic PostCompact continuation. The hook event can arrive while its
 * own shell process is still exiting, so wait briefly for Claude's idle prompt
 * instead of racing an injection into the compaction teardown. The 10-minute
 * patrol remains a durable fallback, but a healthy hook path re-drives within
 * seconds of the boundary.
 */
export async function continueCompactedAgentAfterHook(
  args: ContinueAfterPostCompactHookArgs,
): Promise<string | null> {
  const readState = args.readState ?? getAgentStateSync;
  const state = readState(args.agentId);
  if (!state || !shouldContinueAfterCompaction(state).ok) return null;
  if (postCompactContinuationInFlight.has(args.agentId)) return null;
  postCompactContinuationInFlight.add(args.agentId);

  try {
    const attempts = args.attempts ?? POST_COMPACT_PROMPT_POLL_ATTEMPTS;
    const intervalMs = args.intervalMs ?? POST_COMPACT_PROMPT_POLL_INTERVAL_MS;
    const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const continueAgent = args.continueAgent ?? maybeContinueCompactedAgent;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const tmuxOutput = await args.capturePane(args.agentId);
        const continued = await continueAgent({
          agentId: args.agentId,
          tmuxOutput,
          send: args.send,
          findBoundary: args.findBoundary,
          readState,
        });
        if (continued) return continued;
      } catch {
        // The pane or transcript can be between compaction writes. Retry inside
        // this hook-owned window; the patrol remains the fallback after it ends.
      }
      if (attempt < attempts) await sleep(intervalMs);
    }

    return null;
  } finally {
    postCompactContinuationInFlight.delete(args.agentId);
  }
}

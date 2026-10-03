/**
 * Live effort change for a running claude-code pane (PAN-4255).
 *
 * One core for both doors — `POST /api/conversations/:name/thinking-level`
 * (claude-code branch) and `POST /api/agents/:id/effort`. It delivers
 * `/effort <level>` through the terminal backend and reports success only
 * after Claude Code writes its `<local-command-stdout>Set effort level to …`
 * confirmation record into the session transcript. Callers persist the level
 * only on `ok: true`.
 *
 * Order: busy check → permission-prompt check (PAN-4278) → ensure the main
 * agent has the input (PAN-4268) → transcript snapshot → deliver → poll the
 * transcript from the pre-delivery offset.
 */
import { open } from 'node:fs/promises';
import type { EffortLevel } from '@overdeck/contracts';
import { parseEffortCommandStdout } from '../claude-effort-transcript.js';
import { PANE_CAPTURE_LINES } from '../session-pane-choice.js';
import { resolveAgentPaneIo } from '../terminal-backends/agent-pane-io.js';
import { captureTranscriptUserRecordSnapshot } from '../transcript-landing.js';
import { deliverAgentMessage } from './delivery.js';
import { waitForAgentIdle } from './identity.js';
import { ensureMainInputTarget } from './input-target.js';
import { parsePermissionPrompt } from './permission-prompt.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';

export interface ClaudeLiveEffortTarget {
  /** Pane address: conv.tmuxSession for conversations, the agent id for agents. */
  paneId: string;
  /** conv.cwd / agentState.workspace — locates the transcript. */
  workspace: string;
  /** conv.claudeSessionId / the agent's latest session id. */
  sessionId: string;
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';
  caller: 'conversation-effort' | 'agent-effort';
}

export type ClaudeLiveEffortFailureCode =
  | 'busy'
  | 'permission-pending'
  | 'input-target-not-main'
  | 'not-delivered'
  | 'not-confirmed'
  | 'effort-rejected';

export type ClaudeLiveEffortResult =
  | { ok: true; effort: EffortLevel }
  | { ok: false; code: ClaudeLiveEffortFailureCode; error: string };

export interface TranscriptReadSince {
  records: unknown[];
  nextOffset: number;
}

export interface ClaudeLiveEffortDeps {
  waitForIdle?: typeof waitForAgentIdle;
  runtimeState?: typeof getAgentRuntimeStateSync;
  /** Default: the pane's visible text; a read failure is null (no prompt). */
  readPane?: (paneId: string) => Promise<string | null>;
  ensureMain?: typeof ensureMainInputTarget;
  snapshot?: typeof captureTranscriptUserRecordSnapshot;
  deliver?: typeof deliverAgentMessage;
  readSince?: (sessionFile: string, offset: number) => Promise<TranscriptReadSince>;
}

export const LIVE_EFFORT_IDLE_TIMEOUT_MS = 5000;
export const LIVE_EFFORT_CONFIRM_TIMEOUT_MS = 10000;
export const LIVE_EFFORT_POLL_MS = 250;

/** HTTP status for each failure code, shared by both doors. */
export const LIVE_EFFORT_FAILURE_STATUS: Record<ClaudeLiveEffortFailureCode, number> = {
  busy: 409,
  'permission-pending': 409,
  'input-target-not-main': 409,
  'effort-rejected': 422,
  'not-delivered': 502,
  'not-confirmed': 504,
};

const NOT_CONFIRMED_ERROR =
  'Claude Code did not confirm the effort change within 10 s; the stored effort is unchanged.';

async function readPaneText(paneId: string): Promise<string | null> {
  try {
    const io = await resolveAgentPaneIo(paneId);
    return await io.read(PANE_CAPTURE_LINES);
  } catch {
    return null;
  }
}

/**
 * Read complete JSONL lines from `offset` to EOF. A trailing partial line is
 * left for the next call: `nextOffset` stops after the last newline. A missing
 * file (a session with no records yet) reads as empty.
 */
export async function readTranscriptRecordsSince(sessionFile: string, offset: number): Promise<TranscriptReadSince> {
  let handle;
  try {
    handle = await open(sessionFile, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], nextOffset: offset };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size <= offset) return { records: [], nextOffset: offset };
    const buffer = Buffer.alloc(size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const chunk = buffer.subarray(0, bytesRead);
    const lastNewline = chunk.lastIndexOf(0x0a);
    if (lastNewline < 0) return { records: [], nextOffset: offset };
    const records: unknown[] = [];
    for (const line of chunk.subarray(0, lastNewline).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A malformed line cannot be a confirmation record; skip it.
      }
    }
    return { records, nextOffset: offset + lastNewline + 1 };
  } finally {
    await handle.close();
  }
}

function userStringContent(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const entry = record as Record<string, unknown>;
  if (entry['type'] !== 'user' || entry['isSidechain'] === true) return null;
  const message = entry['message'];
  if (!message || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : null;
}

export async function applyClaudeLiveEffort(
  target: ClaudeLiveEffortTarget,
  level: EffortLevel,
  deps: ClaudeLiveEffortDeps = {},
): Promise<ClaudeLiveEffortResult> {
  const waitForIdle = deps.waitForIdle ?? waitForAgentIdle;
  const runtimeState = deps.runtimeState ?? getAgentRuntimeStateSync;
  const readPane = deps.readPane ?? readPaneText;
  const ensureMain = deps.ensureMain ?? ensureMainInputTarget;
  const snapshot = deps.snapshot ?? captureTranscriptUserRecordSnapshot;
  const deliver = deps.deliver ?? deliverAgentMessage;
  const readSince = deps.readSince ?? readTranscriptRecordsSince;

  // Claude Code queues typed input during a turn, so a /effort sent now could
  // run after the confirmation window. Refuse only when the mirror affirmatively
  // says the session is working; unknown state proceeds, as messageAgent does.
  const idle = await waitForIdle(target.paneId, LIVE_EFFORT_IDLE_TIMEOUT_MS);
  if (!idle && runtimeState(target.paneId)?.state === 'active') {
    return { ok: false, code: 'busy', error: 'The session is mid-turn. Change effort when it is idle.' };
  }

  // PAN-4278: never paste into a permission prompt. Checked before ensure-main,
  // whose Down/Enter would answer it.
  const paneText = await readPane(target.paneId);
  if (paneText && parsePermissionPrompt(paneText)) {
    return { ok: false, code: 'permission-pending', error: 'Waiting: the agent needs a permission answer first' };
  }

  const main = await ensureMain(target.paneId);
  if (!main.ok) return { ok: false, code: 'input-target-not-main', error: main.reason };

  const before = await snapshot(target.workspace, target.sessionId);
  let offset = before.readOffset ?? before.fileSize ?? 0;

  try {
    const delivery = await deliver(target.paneId, `/effort ${level}`, target.caller, target.deliveryMethod);
    if (!delivery.ok) {
      return { ok: false, code: 'not-delivered', error: delivery.failure ?? 'the terminal refused the message' };
    }
  } catch (error) {
    return { ok: false, code: 'not-delivered', error: error instanceof Error ? error.message : String(error) };
  }

  const deadline = Date.now() + LIVE_EFFORT_CONFIRM_TIMEOUT_MS;
  while (true) {
    const read = await readSince(before.sessionFile, offset).catch(() => ({ records: [], nextOffset: offset }));
    offset = read.nextOffset;
    for (const record of read.records) {
      const content = userStringContent(record);
      if (content === null) continue;
      const result = parseEffortCommandStdout(content);
      if (result?.kind === 'set') return { ok: true, effort: result.level };
      if (result?.kind === 'rejected') return { ok: false, code: 'effort-rejected', error: result.message };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, LIVE_EFFORT_POLL_MS));
  }
  return { ok: false, code: 'not-confirmed', error: NOT_CONFIRMED_ERROR };
}

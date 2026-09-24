/**
 * Whether a non-Claude harness's transcript says its newest turn finished
 * (#4169). Herdr reports `idle`/`done` only for Claude Code panes; every other
 * harness runs pane-bound and reads `unknown`, so the warm-idle reap
 * (`warm-idle-reap.ts`) asks the harness's own transcript instead.
 *
 * Each reader walks the transcript's tail backwards to the newest record that
 * starts or ends a turn:
 *
 * - codex (rollout JSONL): the newest `task_started` / `task_complete` /
 *   `turn_aborted` event (`codexThreadStatus`).
 * - kimi (wire.jsonl): the newest `turn.prompt`, `step.begin` or `step.end`;
 *   finished only on a `step.end` whose `finishReason` is `end_turn`.
 * - pi / ohmypi (session JSONL): the newest `message` record; finished only on
 *   an assistant message with `stopReason` `stop` or `aborted`. `error` is not
 *   finished: Pi retries some provider errors itself.
 * - acp (ACP host transcript, also OpenCode): the newest lifecycle entry;
 *   finished on `turn_completed` or `prompt_failed` (the host never retries a
 *   failed prompt), not finished on a user prompt or a `prompt_queued`.
 *
 * Every other kind (claude, muse) answers false, as does a missing, unreadable
 * or non-regular file.
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { codexThreadStatus } from '../conversations/codex-thread-status.js';
import type { TranscriptCandidateKind } from '../session-history.js';

const TAIL_BYTES = 128 * 1024;

type JsonRecord = { [key: string]: unknown };

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

/** The tail's parseable records, newest first. A cut first line is dropped. */
async function readTailRecordsNewestFirst(path: string): Promise<JsonRecord[]> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) return [];
    const start = Math.max(0, info.size - TAIL_BYTES);
    const buffer = Buffer.alloc(info.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    const records: JsonRecord[] = [];
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      try {
        const record = asRecord(JSON.parse(line));
        if (record) records.push(record);
      } catch {
        // A torn line (a write in progress) is skipped.
      }
    }
    return records;
  } finally {
    await handle.close();
  }
}

function kimiTurnFinished(recordsNewestFirst: readonly JsonRecord[]): boolean {
  for (const record of recordsNewestFirst) {
    if (record.type === 'turn.prompt') return false;
    if (record.type !== 'context.append_loop_event') continue;
    const event = asRecord(record.event);
    if (event?.type === 'step.begin') return false;
    if (event?.type === 'step.end') return event.finishReason === 'end_turn';
  }
  return false;
}

const PI_FINISHED_STOP_REASONS = new Set(['stop', 'aborted']);

function piTurnFinished(recordsNewestFirst: readonly JsonRecord[]): boolean {
  for (const record of recordsNewestFirst) {
    if (record.type !== 'message') continue;
    const message = asRecord(record.message);
    return message?.role === 'assistant'
      && typeof message.stopReason === 'string'
      && PI_FINISHED_STOP_REASONS.has(message.stopReason);
  }
  return false;
}

function acpTurnFinished(recordsNewestFirst: readonly JsonRecord[]): boolean {
  for (const record of recordsNewestFirst) {
    if (record.event === 'turn_completed' || record.event === 'prompt_failed') return true;
    if (record.event === 'prompt_queued' || record.role === 'user') return false;
  }
  return false;
}

/** True only when the transcript's newest turn provably ended (see the module comment). */
export async function transcriptTurnFinished(kind: TranscriptCandidateKind, path: string): Promise<boolean> {
  try {
    if (kind === 'codex') return (await codexThreadStatus(path)) === 'done';
    if (kind === 'kimi') return kimiTurnFinished(await readTailRecordsNewestFirst(path));
    if (kind === 'pi' || kind === 'ohmypi') return piTurnFinished(await readTailRecordsNewestFirst(path));
    if (kind === 'acp') return acpTurnFinished(await readTailRecordsNewestFirst(path));
  } catch {
    return false;
  }
  return false;
}

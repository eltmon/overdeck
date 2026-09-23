/**
 * Waiting for a worker's report (PAN-3920 D16, D18).
 *
 * `waitForWorkerReport` polls every 2 s for a report. Without `afterSeq` any
 * report counts, and the newest one is returned (so a report written while
 * nobody was waiting is never missed). With `afterSeq: n` it returns the next
 * report after `n`, the one a caller that consumed report `n` has not seen.
 * Each poll also asks the one liveness
 * oracle (`isAlive`): a confirmed death with no report is
 * `exited-without-report`; a worker idle for longer than `idleGraceMs` with no
 * report is `idle-without-report` and is left running. A deadline returns
 * `timeout`. The wait never messages the worker.
 *
 * A death only counts once the worker has been seen alive, or once
 * `startupGraceMs` has passed: right after launch the harness process may not
 * be in the pane yet, and the oracle then answers "runtime missing".
 *
 * The last-assistant-message fallback reads the dashboard's agent transcript
 * route; when the dashboard is unreachable it gives the transcript path
 * instead. This module never imports dashboard-server parsers.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDashboardApiUrlSync } from '../../config.js';
import { idleAgeMs as defaultIdleAgeMs, isAlive as defaultIsAlive, isConfirmedDead, type LivenessVerdict } from '../liveness.js';
import { resolveJsonlPath } from '../transcript-resolver.js';
import { workerDir } from './ids.js';
import { listWorkerReports, type WorkerReport } from './report.js';

export type WaitOutcome =
  | { kind: 'report'; report: WorkerReport }
  | { kind: 'exited-without-report' | 'idle-without-report'; lastAssistantMessage: string | null; transcriptPath: string | null }
  | { kind: 'timeout' };

export interface WaitOptions {
  /**
   * Return the first report with a greater `seq` (the next unconsumed one).
   * Absent: return the newest report that exists, whenever it was written.
   */
  afterSeq?: number;
  /** Deadline in ms; null or absent waits without one. */
  timeoutMs?: number | null;
  /** How long a reportless idle worker is tolerated. Default 10 minutes. */
  idleGraceMs?: number;
  /** How long a death is ignored when the worker was never seen alive, and before idleness counts. Default 60 s. */
  startupGraceMs?: number;
  /** Poll interval. Default 2 s. */
  pollMs?: number;
  signal?: AbortSignal;
}

export interface WaitDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  listReports?: (id: string) => Promise<WorkerReport[]>;
  isAlive?: (id: string) => Promise<LivenessVerdict>;
  idleAgeMs?: (id: string, now: number) => number | null;
  fetchLastAssistantMessage?: (id: string) => Promise<string | null>;
  resolveTranscriptPath?: (id: string) => Promise<string | null>;
}

export const WAIT_POLL_MS = 2_000;
export const WAIT_IDLE_GRACE_MS = 10 * 60_000;
export const WAIT_STARTUP_GRACE_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The last `role === 'assistant'` message of the agent transcript route (D18). */
export async function fetchLastAssistantMessageFromDashboard(id: string): Promise<string | null> {
  const url = `${getDashboardApiUrlSync()}/api/agents/${encodeURIComponent(id)}/conversation`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`dashboard answered ${response.status}`);
  // ConversationResponse: `messages` are ChatMessage `{ role, text }` (packages/contracts rpc.ts).
  const payload = await response.json() as { messages?: Array<{ role?: string; text?: unknown }> };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && typeof message.text === 'string' && message.text.trim()) return message.text;
  }
  return null;
}

async function defaultResolveTranscriptPath(id: string): Promise<string | null> {
  try {
    const raw = await readFile(join(workerDir(id), 'state.json'), 'utf8');
    const workspace = (JSON.parse(raw) as { workspace?: string }).workspace ?? '';
    return await resolveJsonlPath(id, workspace);
  } catch {
    return null;
  }
}

async function reportlessOutcome(
  kind: 'exited-without-report' | 'idle-without-report',
  id: string,
  fetchLast: (id: string) => Promise<string | null>,
  resolvePath: (id: string) => Promise<string | null>,
): Promise<WaitOutcome> {
  const lastAssistantMessage = await fetchLast(id).catch(() => null);
  const transcriptPath = lastAssistantMessage === null ? await resolvePath(id).catch(() => null) : null;
  return { kind, lastAssistantMessage, transcriptPath };
}

export async function waitForWorkerReport(id: string, options: WaitOptions = {}, deps: WaitDeps = {}): Promise<WaitOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const listReports = deps.listReports ?? listWorkerReports;
  const isAlive = deps.isAlive ?? ((agentId: string) => defaultIsAlive(agentId));
  const idleAge = deps.idleAgeMs ?? defaultIdleAgeMs;
  const fetchLast = deps.fetchLastAssistantMessage ?? fetchLastAssistantMessageFromDashboard;
  const resolvePath = deps.resolveTranscriptPath ?? defaultResolveTranscriptPath;
  const pollMs = options.pollMs ?? WAIT_POLL_MS;
  const idleGraceMs = options.idleGraceMs ?? WAIT_IDLE_GRACE_MS;
  const startupGraceMs = options.startupGraceMs ?? WAIT_STARTUP_GRACE_MS;

  const startedAt = now();
  const deadline = typeof options.timeoutMs === 'number' ? startedAt + options.timeoutMs : null;
  const baseline = options.afterSeq ?? 0;
  const pick = (reports: WorkerReport[]): WorkerReport | undefined => {
    const fresh = reports.filter((report) => report.seq > baseline);
    return options.afterSeq === undefined ? fresh.at(-1) : fresh[0];
  };
  let seenAlive = false;

  for (;;) {
    if (options.signal?.aborted) return { kind: 'timeout' };
    const fresh = pick(await listReports(id));
    if (fresh) return { kind: 'report', report: fresh };

    const verdict = await isAlive(id);
    if (verdict.alive) seenAlive = true;
    const current = now();
    if (isConfirmedDead(verdict) && (seenAlive || current - startedAt >= startupGraceMs)) {
      // The worker may have reported in the moment before it exited.
      const last = pick(await listReports(id));
      if (last) return { kind: 'report', report: last };
      return reportlessOutcome('exited-without-report', id, fetchLast, resolvePath);
    }
    // Idleness counts only after the startup grace: right after a `pan tell` the
    // worker's last activity is still the old turn until its hooks fire.
    if (verdict.alive && current - startedAt >= startupGraceMs) {
      const idle = idleAge(id, current);
      if (idle !== null && idle > idleGraceMs) {
        return reportlessOutcome('idle-without-report', id, fetchLast, resolvePath);
      }
    }
    if (deadline !== null && current >= deadline) return { kind: 'timeout' };

    const wait = deadline === null ? pollMs : Math.max(0, Math.min(pollMs, deadline - current));
    await sleep(wait);
  }
}

/**
 * Waiting on gauntlet lanes (.pan/drafts/pan-4223.md WI-6 step 4, FR-13, FR-14).
 *
 * `waitForLane` is `waitForWorkerReport` keyed `conv-<name>` with lane
 * liveness: the conversation harness for alive/dead, and the lane view for
 * idleness. `waitForLaneSet` waits on every lane of a run (or of a parent) and
 * returns the next report after a cursor `<atMs>.<name>.<seq>`, oldest first,
 * so an orchestrator consumes a run's reports one by one without missing any.
 * Set waits never return reportless outcomes; a stopped lane with no report
 * since the cursor gets one warning line per call instead.
 *
 * These run in the CLI, so lane views and transcripts come from the dashboard
 * API, never from the server modules.
 */
import { conversationHarnessAlive } from '../overdeck/conversation-liveness.js';
import { getDashboardApiUrl } from '../config.js';
import { listWorkerReports, type WorkerReport } from '../agents/worker/report.js';
import { waitForWorkerReport, WAIT_POLL_MS, type WaitDeps, type WaitOptions, type WaitOutcome } from '../agents/worker/wait.js';
import type { LaneView } from './views.js';

/** The lane view fields the waits read. */
export type LaneWaitView = Pick<LaneView, 'name' | 'run' | 'key' | 'activity' | 'lastActivityAt'>;

export interface LaneWaitDeps extends Pick<WaitDeps, 'now' | 'sleep' | 'listReports'> {
  harnessAlive?: (tmuxSession: string) => Promise<boolean>;
  fetchLane?: (name: string) => Promise<LaneWaitView | null>;
  fetchLastAssistantMessage?: (name: string) => Promise<string | null>;
  resolveTranscriptPath?: (name: string) => Promise<string | null>;
}

async function dashboardJson(path: string): Promise<unknown> {
  const response = await fetch(`${getDashboardApiUrl()}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`dashboard answered ${response.status} for ${path}`);
  return response.json();
}

async function fetchLaneFromDashboard(name: string): Promise<LaneWaitView | null> {
  return (await dashboardJson(`/api/lanes/${encodeURIComponent(name)}`)) as LaneWaitView | null;
}

async function fetchLanesFromDashboard(filter: LaneSetFilter): Promise<LaneWaitView[]> {
  const params = new URLSearchParams();
  if (filter.run) params.set('run', filter.run);
  if (filter.parent) params.set('parent', filter.parent);
  const payload = (await dashboardJson(`/api/lanes?${params.toString()}`)) as { lanes?: LaneWaitView[] } | null;
  return payload?.lanes ?? [];
}

/** The last assistant message of `GET /api/conversations/:name/messages` (ChatMessage `{ role, text }`). */
async function fetchLastAssistantFromDashboard(name: string): Promise<string | null> {
  const payload = (await dashboardJson(`/api/conversations/${encodeURIComponent(name)}/messages`)) as
    { messages?: Array<{ role?: string; text?: unknown }> } | null;
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && typeof message.text === 'string' && message.text.trim()) return message.text;
  }
  return null;
}

async function resolveLaneTranscriptPath(name: string): Promise<string | null> {
  const { getConversationByName } = await import('../overdeck/conversations.js');
  const { resolveSessionFile } = await import('../overdeck/conversation-reads.js');
  const conv = getConversationByName(name);
  return conv ? resolveSessionFile(conv) : null;
}

/** One lane's next report, with `pan worker wait` semantics (FR-13). */
export function waitForLane(name: string, options: WaitOptions = {}, deps: LaneWaitDeps = {}): Promise<WaitOutcome> {
  const tmuxSession = `conv-${name}`;
  const harnessAlive = deps.harnessAlive ?? ((session: string) => conversationHarnessAlive(session));
  const fetchLane = deps.fetchLane ?? fetchLaneFromDashboard;
  return waitForWorkerReport(tmuxSession, options, {
    now: deps.now,
    sleep: deps.sleep,
    listReports: deps.listReports,
    isAlive: async () => ((await harnessAlive(tmuxSession))
      ? { alive: true, paneAlive: true }
      : { alive: false, reason: 'no-session' }),
    idleAgeMs: async (_id, now) => {
      const lane = await fetchLane(name).catch(() => null);
      if (!lane) return null;
      if (lane.activity === 'working') return 0;
      return lane.lastActivityAt ? now - Date.parse(lane.lastActivityAt) : null;
    },
    fetchLastAssistantMessage: () => (deps.fetchLastAssistantMessage ?? fetchLastAssistantFromDashboard)(name),
    resolveTranscriptPath: () => (deps.resolveTranscriptPath ?? resolveLaneTranscriptPath)(name),
  });
}

export interface LaneSetFilter {
  run?: string;
  parent?: string;
}

export interface LaneSetOptions {
  /** Return the first report whose cursor sorts after this one. Absent: from the start. */
  after?: string;
  /** Deadline in ms; null or absent waits without one. */
  timeoutMs?: number | null;
  pollMs?: number;
}

export type LaneSetOutcome =
  | { kind: 'report'; lane: LaneWaitView; report: WorkerReport; cursor: string }
  | { kind: 'timeout'; cursor: string };

export interface LaneSetDeps extends Pick<WaitDeps, 'now' | 'sleep' | 'listReports'> {
  listLanes?: (filter: LaneSetFilter) => Promise<LaneWaitView[]>;
  /** One stderr line per stopped, reportless lane per call. */
  warn?: (line: string) => void;
}

interface Cursor {
  atMs: number;
  name: string;
  seq: number;
}

export function laneCursor(name: string, report: Pick<WorkerReport, 'at' | 'seq'>): string {
  return `${Date.parse(report.at)}.${name}.${report.seq}`;
}

function parseCursor(raw: string): Cursor | null {
  const first = raw.indexOf('.');
  const last = raw.lastIndexOf('.');
  if (first <= 0 || last <= first) return null;
  const atMs = Number(raw.slice(0, first));
  const seq = Number(raw.slice(last + 1));
  if (!Number.isFinite(atMs) || !Number.isFinite(seq)) return null;
  return { atMs, name: raw.slice(first + 1, last), seq };
}

function compareCursors(a: Cursor, b: Cursor): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.seq - b.seq;
}

/** The next report of any lane in the set after `after`, oldest first (FR-14). */
export async function waitForLaneSet(filter: LaneSetFilter, options: LaneSetOptions = {}, deps: LaneSetDeps = {}): Promise<LaneSetOutcome> {
  if (!filter.run && !filter.parent) throw new Error('a lane set needs --run or --parent');
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const listLanes = deps.listLanes ?? fetchLanesFromDashboard;
  const listReports = deps.listReports ?? listWorkerReports;
  const warn = deps.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
  const pollMs = options.pollMs ?? WAIT_POLL_MS;
  const inputCursor = options.after ?? '';
  let after: Cursor | null = null;
  if (options.after) {
    after = parseCursor(options.after);
    if (!after) throw new Error(`invalid cursor ${options.after}: expected <atMs>.<name>.<seq>`);
  }
  const deadline = typeof options.timeoutMs === 'number' ? now() + options.timeoutMs : null;
  const warned = new Set<string>();

  for (;;) {
    let next: { lane: LaneWaitView; report: WorkerReport; cursor: Cursor } | null = null;
    for (const lane of await listLanes(filter)) {
      let fresh = 0;
      for (const report of await listReports(`conv-${lane.name}`)) {
        const cursor = { atMs: Date.parse(report.at), name: lane.name, seq: report.seq };
        if (after && compareCursors(cursor, after) <= 0) continue;
        fresh += 1;
        if (!next || compareCursors(cursor, next.cursor) < 0) next = { lane, report, cursor };
      }
      if (fresh === 0 && lane.activity === 'stopped' && !warned.has(lane.name)) {
        warned.add(lane.name);
        warn(`lane ${lane.run}/${lane.key} (${lane.name}) is stopped with no report since the cursor`);
      }
    }
    if (next) return { kind: 'report', lane: next.lane, report: next.report, cursor: laneCursor(next.lane.name, next.report) };
    if (deadline !== null && now() >= deadline) return { kind: 'timeout', cursor: inputCursor };
    await sleep(deadline === null ? pollMs : Math.max(0, Math.min(pollMs, deadline - now())));
  }
}

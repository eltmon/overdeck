/**
 * The Agents page Live view's classification (PAN-4197 WI-4). Pure: no React,
 * no store.
 *
 * Every row of the live scope (`GET /api/agent-directory?scope=live`) gets
 * exactly one reason, from a fixed precedence (D4): human-actionable facts
 * first (a blocked input, an operator pause, a broken agent, a PR ready to
 * merge), then machine work, then pipeline waits. The reason decides the
 * row's section (Needs you, Live, Waiting) and its state tone (the --state-*
 * tokens). A row with nothing nameable to wait on (idle with no blocker, or
 * stopped) is not Waiting: it goes to the Idle section, a collapsed footer
 * the header does not count (UX critic round 1). Facts come from the entry itself plus real-time store facts the
 * caller passes in: the issue's derived state, the agent's pending inputs and
 * its runtime snapshot.
 */
import type { DerivedIssueState, DirectoryEntry } from '@overdeck/contracts';

export type LiveSection = 'needs-you' | 'live' | 'waiting' | 'idle';
export type LiveTone = 'live' | 'needs-you' | 'stuck' | 'waiting';
export type LiveReasonKind =
  | 'question' | 'permission' | 'plan-approval' | 'paused' | 'api-error' | 'stuck' | 'ready-to-merge'
  | 'working' | 'remote'
  | 'held' | 'ci-failed' | 'changes-requested' | 'in-review' | 'ci-running' | 'idle' | 'stopped';

export interface LiveReason {
  kind: LiveReasonKind;
  section: LiveSection;
  tone: LiveTone;
  label: string;
  detail: string | null;
}

export interface LiveFacts {
  /** `derivedIssueStateByIssueId[entry.issueId]`. */
  derived?: DerivedIssueState;
  /** `agentsById[entry.id]?.pendingInputKinds`. */
  pendingInputKinds?: readonly string[];
  /** `agentsById[entry.id]?.pendingQuestionPrompt`. */
  pendingQuestionPrompt?: string | null;
  /** `agentRuntimeById[entry.id]`. */
  runtime?: { activity?: string; currentTool?: string; lastActivity?: string };
}

export interface LiveRow {
  entry: DirectoryEntry;
  reason: LiveReason;
  /** Needs you: when the wait began. Live, Waiting and Idle: the last activity. */
  since: string | null;
  /** Subagents nested under this row (FR-8), then its gauntlet lanes (PAN-4223 FR-19). */
  children: DirectoryEntry[];
}

export interface LiveSections {
  needsYou: LiveRow[];
  live: LiveRow[];
  waiting: LiveRow[];
  idle: LiveRow[];
}

/** A Live row quiet longer than this shows `· quiet <age>` (FR-5). */
export const LIVE_QUIET_AFTER_MS = 5 * 60_000;

const OUTPUT_LINE_MAX = 160;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Roles whose pane the issue's derived attention and pipeline state describe. */
const ISSUE_AGENT_ROLES = new Set(['work', 'strike']);

function isIssueAgent(entry: DirectoryEntry): boolean {
  return entry.kind === 'agent' && entry.issueId !== null && ISSUE_AGENT_ROLES.has(entry.role ?? '');
}

/** Compact idle age: minutes under an hour, hours under two days, else days. */
function idleAge(iso: string | null, now: Date): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function reason(kind: LiveReasonKind, section: LiveSection, tone: LiveTone, label: string, detail: string | null = null): LiveReason {
  return { kind, section, tone, label, detail };
}

/** What a live agent is doing now: `running <tool>`, `thinking`, else `working`. */
export function activityLabel(runtime: LiveFacts['runtime']): string {
  if (runtime?.currentTool) return `running ${runtime.currentTool}`;
  if (runtime?.activity === 'thinking') return 'thinking';
  return 'working';
}

/** The last non-empty line of an agent's output, ANSI stripped, at most 160 characters. */
export function lastOutputLine(lines: readonly string[] | undefined): string | null {
  if (!lines) return null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.replace(ANSI_RE, '').trim();
    if (!line) continue;
    return line.length > OUTPUT_LINE_MAX ? `${line.slice(0, OUTPUT_LINE_MAX - 1)}…` : line;
  }
  return null;
}

/** The one reason for a row, first match wins (PRD WI-4 precedence table). */
export function classifyEntry(entry: DirectoryEntry, facts: LiveFacts, now: Date = new Date()): LiveReason {
  const issueAgent = isIssueAgent(entry);
  const derived = issueAgent ? facts.derived : undefined;
  const kinds = facts.pendingInputKinds ?? [];

  if (entry.state === 'blocked') {
    if (kinds.includes('permissionRequest')) return reason('permission', 'needs-you', 'needs-you', 'permission prompt');
    if (kinds.includes('exitPlanMode') || kinds.includes('enterPlanMode')) {
      return reason('plan-approval', 'needs-you', 'needs-you', 'plan approval');
    }
    return reason('question', 'needs-you', 'needs-you', 'question waiting', facts.pendingQuestionPrompt || null);
  }
  if (entry.pause?.by === 'operator') return reason('paused', 'needs-you', 'needs-you', 'paused by you', entry.pause.reason);
  if (derived?.attention === 'api-error') return reason('api-error', 'needs-you', 'stuck', 'API error or usage limit');
  if (derived?.attention === 'stuck' && entry.state === 'idle') {
    const age = idleAge(entry.lastActivityAt, now);
    return reason('stuck', 'needs-you', 'stuck', age === null ? 'stuck' : `stuck · idle ${age}`);
  }
  if (derived?.state === 'ready') return reason('ready-to-merge', 'needs-you', 'needs-you', 'ready to merge');
  if (entry.state === 'working') return reason('working', 'live', 'live', activityLabel(facts.runtime));
  if (entry.state === 'unknown' && entry.location === 'remote') return reason('remote', 'live', 'live', 'running on Fly');
  if (entry.pause) return reason('held', 'waiting', 'waiting', 'held by Overdeck', entry.pause.reason);
  if (derived?.pr?.checks === 'red') return reason('ci-failed', 'waiting', 'stuck', 'CI failed');
  if (derived?.state === 'changes-requested') return reason('changes-requested', 'waiting', 'waiting', 'changes requested');
  if (derived?.state === 'in-review') return reason('in-review', 'waiting', 'waiting', 'in review');
  if (derived?.pr?.checks === 'pending') return reason('ci-running', 'waiting', 'waiting', 'CI running');
  if (entry.state === 'idle') return reason('idle', 'idle', 'waiting', 'idle — no known blocker');
  return reason('stopped', 'idle', 'waiting', 'agent stopped');
}

function sinceOf(entry: DirectoryEntry, why: LiveReason, facts: LiveFacts): string | null {
  if (why.kind === 'paused' || why.kind === 'held') return entry.pause?.since ?? entry.lastActivityAt;
  if (why.section === 'live') return facts.runtime?.lastActivity ?? entry.lastActivityAt;
  return entry.lastActivityAt;
}

function timeOf(iso: string | null): number | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Orders rows by one timestamp, missing last, ties by id. */
function compareRows(direction: 'asc' | 'desc', timeFor: (row: LiveRow) => string | null = (row) => row.since) {
  return (a: LiveRow, b: LiveRow): number => {
    const at = timeOf(timeFor(a));
    const bt = timeOf(timeFor(b));
    if (at !== bt) {
      if (at === null) return 1;
      if (bt === null) return -1;
      return direction === 'asc' ? at - bt : bt - at;
    }
    return a.entry.id.localeCompare(b.entry.id);
  };
}

/** PAN-4223: the lane role glyph a lane line shows before its key. */
export const LANE_GLYPH: Readonly<Record<string, string>> = {
  builder: 'B',
  critic: 'C',
  verifier: 'V',
  play: 'P',
  orchestrator: 'O',
};

/**
 * Rows grouped into the sections, sorted (FR-4, FR-7). A subagent nests
 * under its parent row and is not a row of its own; one whose parent is not on
 * the page is dropped (FR-8).
 */
/**
 * PAN-4223 FR-19, FR-29, D23: a lane whose parent has a row becomes a child
 * line of that row and loses its own row, unless it needs you (then it has
 * both). A lane under a lane that is itself a child line goes to that lane's
 * host row, so the Live view keeps one level of child lines. A successor (a
 * conversation with a parent but no lane) always keeps its own row.
 */
function attachLanes(entries: readonly DirectoryEntry[], rows: Map<string, LiveRow>): void {
  const isChildLine = (row: LiveRow): boolean =>
    row.entry.kind === 'conversation' && Boolean(row.entry.lane) && row.reason.section !== 'needs-you'
    && row.entry.parentId !== null && rows.has(row.entry.parentId);
  const hostOf = (entry: DirectoryEntry): LiveRow | undefined => {
    const seen = new Set<string>([entry.id]);
    let parentId = entry.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = rows.get(parentId);
      if (!parent) return undefined;
      if (!isChildLine(parent)) return parent;
      parentId = parent.entry.parentId;
    }
    return undefined;
  };
  const moved: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'conversation' || !entry.lane || !entry.parentId) continue;
    const own = rows.get(entry.id);
    const host = hostOf(entry);
    if (!own || !host) continue;
    host.children.push(entry);
    if (own.reason.section !== 'needs-you') moved.push(entry.id);
  }
  for (const id of moved) rows.delete(id);
}

export function buildLiveSections(
  entries: readonly DirectoryEntry[],
  factsFor: (entry: DirectoryEntry) => LiveFacts,
  now: Date = new Date(),
): LiveSections {
  const rows = new Map<string, LiveRow>();
  for (const entry of entries) {
    if (entry.kind === 'subagent') continue;
    const facts = factsFor(entry);
    const why = classifyEntry(entry, facts, now);
    rows.set(entry.id, { entry, reason: why, since: sinceOf(entry, why, facts), children: [] });
  }
  for (const entry of entries) {
    if (entry.kind !== 'subagent' || !entry.parentId) continue;
    rows.get(entry.parentId)?.children.push(entry);
  }
  attachLanes(entries, rows);

  const sections: LiveSections = { needsYou: [], live: [], waiting: [], idle: [] };
  for (const row of rows.values()) {
    if (row.reason.section === 'needs-you') sections.needsYou.push(row);
    else if (row.reason.section === 'live') sections.live.push(row);
    else if (row.reason.section === 'waiting') sections.waiting.push(row);
    else sections.idle.push(row);
  }
  sections.needsYou.sort(compareRows('asc'));
  // Live is ordered by start time, not activity, so rows never reshuffle under
  // the pointer as agents write output; the age on line 2 is what moves.
  sections.live.sort(compareRows('asc', (row) => row.entry.startedAt));
  sections.waiting.sort(compareRows('desc'));
  sections.idle.sort(compareRows('desc'));
  return sections;
}

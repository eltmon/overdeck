/**
 * The Agents page Live view's classification (PAN-4197 WI-4). Pure: no React,
 * no store.
 *
 * Every row of the live scope (`GET /api/agent-directory?scope=live`) gets
 * exactly one reason, from a fixed precedence (D4): human-actionable facts
 * first (a blocked input, an operator pause, a broken agent, a PR ready to
 * merge), then machine work, then pipeline waits. The reason decides the
 * row's section (Needs you, Live, Waiting) and its state tone (the --state-*
 * tokens). Facts come from the entry itself plus real-time store facts the
 * caller passes in: the issue's derived state, the agent's pending inputs and
 * its runtime snapshot.
 */
import type { DerivedIssueState, DirectoryEntry } from '@overdeck/contracts';

export type LiveSection = 'needs-you' | 'live' | 'waiting';
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
  /** Needs you: when the wait began. Live and Waiting: the last activity. */
  since: string | null;
  /** Subagents nested under this row (FR-8). */
  children: DirectoryEntry[];
}

export interface LiveSections {
  needsYou: LiveRow[];
  live: LiveRow[];
  waiting: LiveRow[];
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
  if (entry.state === 'idle') return reason('idle', 'waiting', 'waiting', 'idle — no known blocker');
  return reason('stopped', 'waiting', 'waiting', 'agent stopped');
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

/** Oldest first (missing last) for Needs you; most recent first for Live and Waiting; ties by id. */
function compareRows(direction: 'asc' | 'desc') {
  return (a: LiveRow, b: LiveRow): number => {
    const at = timeOf(a.since);
    const bt = timeOf(b.since);
    if (at !== bt) {
      if (at === null) return 1;
      if (bt === null) return -1;
      return direction === 'asc' ? at - bt : bt - at;
    }
    return a.entry.id.localeCompare(b.entry.id);
  };
}

/**
 * Rows grouped into the three sections, sorted (FR-4, FR-7). A subagent nests
 * under its parent row and is not a row of its own; one whose parent is not on
 * the page is dropped (FR-8).
 */
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

  const sections: LiveSections = { needsYou: [], live: [], waiting: [] };
  for (const row of rows.values()) {
    if (row.reason.section === 'needs-you') sections.needsYou.push(row);
    else if (row.reason.section === 'live') sections.live.push(row);
    else sections.waiting.push(row);
  }
  sections.needsYou.sort(compareRows('asc'));
  sections.live.sort(compareRows('desc'));
  sections.waiting.sort(compareRows('desc'));
  return sections;
}

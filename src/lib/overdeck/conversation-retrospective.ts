/**
 * Pipeline retrospective kickoff renderer and conversation-create handler.
 *
 * Renders `roles/retrospective.md` into a ready-to-send conversation message
 * by substituting the five placeholders the template contract pins
 * (WINDOW_LABEL, WINDOW_START, WINDOW_END, OVERDECK_HOME, PROJECT_LINES),
 * and delegates the actual conversation creation to `handleConversationCreate`
 * via an injected `createConversation` — the single write door. The handler
 * deliberately never forwards `projectKey` or `issueId`: a retrospective is a
 * No-project conversation.
 *
 * Issue: PAN-3841
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { packageRoot, getOverdeckHome } from '../paths.js';
import { listProjectsAsync, getProjectSync } from '../projects.js';
import { resolveStateReadHomeAsync } from '../state-read-home.js';
import { listIssueRecordsDetailed } from '../pan-dir/record-list.js';

export const RETROSPECTIVE_WINDOWS = {
  '24h': { label: 'last 24 hours', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: 'last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
} as const;
export type RetrospectiveWindow = keyof typeof RETROSPECTIVE_WINDOWS;
export const DEFAULT_RETROSPECTIVE_WINDOW: RetrospectiveWindow = '24h';

export interface RetrospectiveProjectLine {
  key: string;
  path: string;
  stateRoot: string;
  migrated: boolean;
  githubRepo?: string;
}

export function isRetrospectiveWindow(value: unknown): value is RetrospectiveWindow {
  // Use an own-property check instead of `in`: every string key on the
  // Object prototype (constructor / toString / __proto__ / hasOwnProperty…)
  // is a valid `in` lookup, so accepting inherited properties would let a
  // hostile body POST `{ window: 'constructor' }` through validation and
  // crash the renderer on `new Date(NaN)` — variety of malformed shapes.
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RETROSPECTIVE_WINDOWS, value)
  );
}

export function isRetrospectiveRequestBody(value: unknown): value is Record<string, unknown> {
  // Reject non-object bodies (null, arrays, primitives) before the window
  // lookup. The route's readJsonBody defaults malformed JSON to `{}`, but a
  // caller that POSTs `null` or `"constructor"` would otherwise reach
  // `body.window ?? DEFAULT_RETROSPECTIVE_WINDOW` and create a conversation
  // with the silent default — clearly not what an explicit `null` asked for.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Same frontmatter regex as runtime-command.ts roleSystemPromptInjectionSync.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function stripFrontmatter(raw: string): string {
  const fm = raw.match(FRONTMATTER_RE);
  return fm ? raw.slice(fm[0].length) : raw;
}

export function formatProjectLines(projects: RetrospectiveProjectLine[]): string {
  if (projects.length === 0) return '- (no registered projects)';
  return projects
    .map(
      (p) =>
        `- ${p.key}: repo ${p.path}; state root ${p.stateRoot} (${
          p.migrated ? 'migrated layout' : 'legacy .pan layout'
        }); github ${p.githubRepo ?? 'none'}`,
    )
    .join('\n');
}

export function renderRetrospectiveKickoff(input: {
  template: string;
  window: RetrospectiveWindow;
  now: Date;
  overdeckHome: string;
  projects: RetrospectiveProjectLine[];
  /** Server-collected canonical evidence; omitted only by callers that render no evidence. */
  evidence?: RetrospectiveProjectEvidence[];
}): string {
  const { label, ms } = RETROSPECTIVE_WINDOWS[input.window];
  const windowEnd = input.now.toISOString();
  const windowStart = new Date(input.now.getTime() - ms).toISOString();
  return stripFrontmatter(input.template)
    .split('{{WINDOW_LABEL}}').join(label)
    .split('{{WINDOW_START}}').join(windowStart)
    .split('{{WINDOW_END}}').join(windowEnd)
    .split('{{OVERDECK_HOME}}').join(input.overdeckHome)
    .split('{{PROJECT_LINES}}').join(formatProjectLines(input.projects))
    .split('{{EVIDENCE}}').join(formatEvidence(input.evidence ?? []))
    .trim();
}

export async function loadRetrospectiveTemplate(
  path = join(packageRoot, 'roles', 'retrospective.md'),
): Promise<string> {
  // No caching: an operator edit to the template takes effect on the next click.
  return readFile(path, 'utf-8');
}

export async function collectRetrospectiveProjects(): Promise<RetrospectiveProjectLine[]> {
  const projects = await listProjectsAsync();
  const lines: RetrospectiveProjectLine[] = [];
  for (const { key, config } of projects) {
    const home = await resolveStateReadHomeAsync(config, key);
    lines.push({
      key,
      path: config.path,
      stateRoot: home.root,
      migrated: home.migrated,
      githubRepo: config.github_repo,
    });
  }
  return lines;
}

export async function handleRetrospectiveConversationCreate(
  body: unknown,
  deps: {
    createConversation: (body: Record<string, unknown>) => Promise<ReturnType<typeof jsonResponse>>;
    loadTemplate?: () => Promise<string>;
    collectProjects?: () => Promise<RetrospectiveProjectLine[]>;
    now?: () => Date;
    overdeckHome?: () => string;
    /** Injected for tests; defaults to the canonical issue-record read door. */
    listRecords?: (
      project: RetrospectiveProjectLine,
    ) => Promise<RetrospectiveSourceRecord[] | RetrospectiveRecordListing>;
  },
): Promise<ReturnType<typeof jsonResponse>> {
  if (!isRetrospectiveRequestBody(body)) {
    return jsonResponse({ error: 'Invalid body' }, { status: 400 });
  }
  const window = body.window ?? DEFAULT_RETROSPECTIVE_WINDOW;
  if (!isRetrospectiveWindow(window)) {
    return jsonResponse({ error: 'Invalid window' }, { status: 400 });
  }
  const [template, projects] = await Promise.all([
    (deps.loadTemplate ?? loadRetrospectiveTemplate)(),
    (deps.collectProjects ?? collectRetrospectiveProjects)(),
  ]);
  const now = (deps.now ?? (() => new Date()))();
  const windowStart = new Date(now.getTime() - RETROSPECTIVE_WINDOWS[window].ms);
  // Gather the canonical evidence server-side, through the read door, so the
  // conversation never has to reach for a store itself.
  const evidence = await collectRetrospectiveEvidence({
    projects,
    windowStart,
    now,
    listRecords: deps.listRecords ?? listRecordsThroughReadDoor,
  });
  const message = renderRetrospectiveKickoff({
    template,
    window,
    now,
    overdeckHome: (deps.overdeckHome ?? getOverdeckHome)(),
    projects,
    evidence,
  });
  // Forward only the model-routing strings — never projectKey or issueId.
  const model = typeof body.model === 'string' ? body.model : undefined;
  const harness = typeof body.harness === 'string' ? body.harness : undefined;
  const effort = typeof body.effort === 'string' ? body.effort : undefined;
  return deps.createConversation({ message, model, harness, effort });
}

// ─── Canonical evidence bridge ────────────────────────────────────────────────
//
// The retrospective conversation must NOT be told to read record JSON off
// disk: that is a direct-store read of canonical state, which
// sync-sources/rules/single-source-of-truth.md forbids, and the legacy record
// path is issue-workspace scoped (getIssueRecordPath -> getIssueRecordBasePath)
// so a project state-root concatenation is not even equivalent. Instead the
// server collects the evidence itself through the issue-record read door's
// bounded enumeration facet (`listIssueRecords`, which already resolves BOTH
// the migrated layout and the legacy workspace-scoped layout) and renders a
// window-scoped snapshot into the kickoff message.

/** Caps keep the kickoff prompt bounded; anything dropped is disclosed, never silent. */
export const EVIDENCE_LIMITS = {
  maxIssuesPerProject: 40,
  maxFeedbackPerIssue: 10,
  maxSessionsPerIssue: 20,
  maxRecoveryTripsPerIssue: 10,
  maxScopeDriftFiles: 15,
  /**
   * Global ceiling on the rendered snapshot. handleConversationCreate caps the
   * whole kickoff message, so an unbounded snapshot does not just bloat the
   * prompt — it can push the message over that cap and lose the instructions
   * too. Per-row caps alone do not bound this: one record with a megabyte of
   * verificationNotes clears every per-row cap.
   */
  maxRenderedBytes: 262_144,
} as const;

export interface RetrospectiveIssueEvidence {
  issueId: string;
  updated?: string;
  harness?: string;
  model?: string;
  pipeline: Record<string, unknown>;
  feedback: { seq: number; specialist: string; outcome: string; timestamp: string }[];
  feedbackTruncated: number;
  sessionHistory: { timestamp: string; reason: string; agentModel?: string }[];
  sessionHistoryTruncated: number;
  recoveryTrips: { recoveryPath: string; tripCount: number; open: boolean; needsYouEmittedAt?: string }[];
  recoveryTripsTruncated: number;
  scopeDrift?: { outsideDeclaredScope: string[]; declaredScopeUntouched: string[]; truncated: number };
}

export interface RetrospectiveProjectEvidence {
  key: string;
  issues: RetrospectiveIssueEvidence[];
  /** Records the door returned that fell outside the window. */
  outOfWindow: number;
  /** Records with no usable `updated` timestamp — kept, but flagged as undatable. */
  undated: number;
  /** Records dated after `now` (clock skew or hand edit) — excluded, not silently ranked first. */
  future: number;
  /** Directories or record files the read door could not read for this project. */
  unreadable: { path: string; message: string }[];
  /** Issues dropped by the per-project cap. */
  truncated: number;
  /** Populated when the read door itself failed for this project. */
  unavailable?: string;
}

const PIPELINE_EVIDENCE_KEYS = [
  'reviewStatus', 'reviewedAtCommit', 'reviewSpawnedAt', 'testStatus', 'uatStatus',
  'uatNotes', 'verificationStatus', 'verificationNotes', 'mergeStatus', 'prUrl',
] as const;

function pickPipeline(pipeline: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!pipeline) return out;
  for (const key of PIPELINE_EVIDENCE_KEYS) {
    if (pipeline[key] !== undefined && pipeline[key] !== null) out[key] = pipeline[key];
  }
  return out;
}

/**
 * A record is in-window when `updated` parses and falls in `[start, now]`.
 *
 * The upper bound matters: a clock-skewed or hand-edited record dated in the
 * future would otherwise always satisfy `>= start` and silently sit at the top
 * of every window, including windows it predates. Future records are reported
 * as their own omission rather than quietly mixed in.
 */
export function isRecordInWindow(
  updated: string | undefined,
  windowStart: Date,
  now: Date,
): 'in' | 'out' | 'future' | 'undated' {
  if (!updated) return 'undated';
  const parsed = Date.parse(updated);
  if (Number.isNaN(parsed)) return 'undated';
  if (parsed > now.getTime()) return 'future';
  return parsed >= windowStart.getTime() ? 'in' : 'out';
}

/**
 * Newest-first, stable for entries whose timestamp is missing or unparseable
 * (those sort last, keeping their original relative order). The canonical
 * record stores these arrays append-only, i.e. OLDEST first, so slicing without
 * sorting keeps the oldest N and discards exactly the recent activity a
 * retrospective is about.
 */
function newestFirst<T>(items: T[], timestampOf: (item: T) => string | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, at: Date.parse(timestampOf(item) ?? '') }))
    .sort((a, b) => {
      const aBad = Number.isNaN(a.at);
      const bBad = Number.isNaN(b.at);
      if (aBad && bBad) return a.index - b.index;
      if (aBad) return 1;
      if (bBad) return -1;
      if (a.at !== b.at) return b.at - a.at;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function projectIssueEvidence(record: RetrospectiveSourceRecord): RetrospectiveIssueEvidence {
  // Sort before slicing: these arrays are append-only oldest-first, so a plain
  // slice would keep the oldest entries and drop the newest.
  const feedback = newestFirst(record.feedback ?? [], (f) => f.timestamp);
  const sessions = newestFirst(record.sessionHistory ?? [], (s) => s.timestamp);
  const trips = newestFirst(record.recoveryTrips ?? [], (t) => t.needsYouEmittedAt);
  const drift = record.scopeDrift;
  const driftOutside = drift?.outsideDeclaredScope ?? [];
  const driftUntouched = drift?.declaredScopeUntouched ?? [];
  return {
    issueId: record.issueId,
    updated: record.updated,
    harness: record.harness,
    model: record.model,
    pipeline: pickPipeline(record.pipeline as Record<string, unknown> | undefined),
    feedback: feedback.slice(0, EVIDENCE_LIMITS.maxFeedbackPerIssue).map((f) => ({
      seq: f.seq, specialist: f.specialist, outcome: f.outcome, timestamp: f.timestamp,
    })),
    feedbackTruncated: Math.max(0, feedback.length - EVIDENCE_LIMITS.maxFeedbackPerIssue),
    sessionHistory: sessions.slice(0, EVIDENCE_LIMITS.maxSessionsPerIssue).map((s) => ({
      timestamp: s.timestamp, reason: s.reason, agentModel: s.agentModel,
    })),
    sessionHistoryTruncated: Math.max(0, sessions.length - EVIDENCE_LIMITS.maxSessionsPerIssue),
    recoveryTrips: trips.slice(0, EVIDENCE_LIMITS.maxRecoveryTripsPerIssue).map((t) => ({
      recoveryPath: t.recoveryPath, tripCount: t.tripCount, open: t.open, needsYouEmittedAt: t.needsYouEmittedAt,
    })),
    recoveryTripsTruncated: Math.max(0, trips.length - EVIDENCE_LIMITS.maxRecoveryTripsPerIssue),
    scopeDrift: drift
      ? {
        outsideDeclaredScope: driftOutside.slice(0, EVIDENCE_LIMITS.maxScopeDriftFiles),
        declaredScopeUntouched: driftUntouched.slice(0, EVIDENCE_LIMITS.maxScopeDriftFiles),
        // Count BOTH arrays: reporting only the `outside` overflow understated
        // the omission whenever `declaredScopeUntouched` was the longer list.
        truncated: Math.max(0, driftOutside.length - EVIDENCE_LIMITS.maxScopeDriftFiles)
          + Math.max(0, driftUntouched.length - EVIDENCE_LIMITS.maxScopeDriftFiles),
      }
      : undefined,
  };
}

/** The subset of the canonical record this bridge consumes. */
export interface RetrospectiveSourceRecord {
  issueId: string;
  updated?: string;
  harness?: string;
  model?: string;
  pipeline?: unknown;
  feedback?: { seq: number; specialist: string; outcome: string; timestamp: string }[];
  sessionHistory?: { timestamp: string; reason: string; agentModel?: string }[];
  recoveryTrips?: { recoveryPath: string; tripCount: number; open: boolean; needsYouEmittedAt?: string }[];
  scopeDrift?: { outsideDeclaredScope?: string[]; declaredScopeUntouched?: string[] };
}

/** What the read door returns when the caller needs failures as well as records. */
export interface RetrospectiveRecordListing {
  records: RetrospectiveSourceRecord[];
  failures?: { path: string; message: string }[];
}

export async function collectRetrospectiveEvidence(input: {
  projects: RetrospectiveProjectLine[];
  windowStart: Date;
  /** Upper bound of the window; records after it are reported as future-dated. */
  now: Date;
  /** Injected for tests; defaults to the canonical enumeration read door. */
  listRecords: (
    project: RetrospectiveProjectLine,
  ) => Promise<RetrospectiveSourceRecord[] | RetrospectiveRecordListing>;
}): Promise<RetrospectiveProjectEvidence[]> {
  const out: RetrospectiveProjectEvidence[] = [];
  for (const project of input.projects) {
    let records: RetrospectiveSourceRecord[];
    let unreadable: { path: string; message: string }[] = [];
    try {
      const listed = await input.listRecords(project);
      if (Array.isArray(listed)) {
        records = listed;
      } else {
        records = listed.records ?? [];
        unreadable = listed.failures ?? [];
      }
    } catch (error) {
      out.push({
        key: project.key,
        issues: [],
        outOfWindow: 0,
        undated: 0,
        future: 0,
        unreadable: [],
        truncated: 0,
        unavailable: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    let outOfWindow = 0;
    let undated = 0;
    let future = 0;
    const kept: RetrospectiveSourceRecord[] = [];
    for (const record of records) {
      if (!record?.issueId) continue;
      const verdict = isRecordInWindow(record.updated, input.windowStart, input.now);
      if (verdict === 'out') { outOfWindow++; continue; }
      if (verdict === 'future') { future++; continue; }
      if (verdict === 'undated') undated++;
      kept.push(record);
    }
    kept.sort((a, b) => (Date.parse(b.updated ?? '') || 0) - (Date.parse(a.updated ?? '') || 0));
    const capped = kept.slice(0, EVIDENCE_LIMITS.maxIssuesPerProject);
    out.push({
      key: project.key,
      issues: capped.map(projectIssueEvidence),
      outOfWindow,
      undated,
      future,
      unreadable,
      truncated: Math.max(0, kept.length - capped.length),
    });
  }
  return out;
}

/** Renders the snapshot for {{EVIDENCE}}, disclosing every omission explicitly. */
export function formatEvidence(projects: RetrospectiveProjectEvidence[]): string {
  if (projects.length === 0) return '(no registered projects, so no records were gathered)';
  const blocks: string[] = [];
  for (const project of projects) {
    if (project.unavailable) {
      blocks.push(`### ${project.key}\n\nEVIDENCE UNAVAILABLE — the issue-record read door failed for this project: ${project.unavailable}. Treat this project as unexamined; do not infer that nothing happened in it.`);
      continue;
    }
    const unreadableNote = project.unreadable.length
      ? ` ${project.unreadable.length} path(s) could not be read (${project.unreadable
        .slice(0, 3).map((f) => `${f.path}: ${f.message}`).join('; ')}${
        project.unreadable.length > 3 ? '; …' : ''}), so this project's evidence is INCOMPLETE — do not read the absence of an issue here as proof it was quiet.`
      : '';
    if (project.issues.length === 0) {
      const empties = [`${project.outOfWindow} record(s) fell outside it`];
      if (project.future) empties.push(`${project.future} dated after the window end (clock skew; excluded)`);
      blocks.push(`### ${project.key}\n\nNo issue records were updated in this window (${empties.join(', ')}).${unreadableNote || ' No evidence found for this project.'}`);
      continue;
    }
    const lines = [`### ${project.key}`, ''];
    const notes: string[] = [`${project.issues.length} issue record(s) in window`];
    if (project.outOfWindow) notes.push(`${project.outOfWindow} outside the window (not shown)`);
    if (project.future) notes.push(`${project.future} dated after the window end and excluded as clock-skewed`);
    if (project.undated) notes.push(`${project.undated} with no usable \`updated\` timestamp (shown, treat their timing as unknown)`);
    if (project.truncated) notes.push(`${project.truncated} dropped by the ${EVIDENCE_LIMITS.maxIssuesPerProject}-issue cap (most recently updated kept)`);
    lines.push(`${notes.join('; ')}.${unreadableNote}`, '');
    for (const issue of project.issues) {
      lines.push(`- **${issue.issueId}** (updated ${issue.updated ?? 'unknown'}${issue.model ? `, model ${issue.model}` : ''}${issue.harness ? `, harness ${issue.harness}` : ''})`);
      const pipe = Object.entries(issue.pipeline);
      lines.push(pipe.length
        ? `  - pipeline: ${pipe.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`
        : '  - pipeline: (no populated fields)');
      if (issue.feedback.length) {
        lines.push(`  - feedback: ${issue.feedback.map((f) => `#${f.seq} ${f.specialist} ${f.outcome} @ ${f.timestamp}`).join(' | ')}${issue.feedbackTruncated ? ` (+${issue.feedbackTruncated} more not shown)` : ''}`);
      }
      if (issue.sessionHistory.length) {
        const reasons = issue.sessionHistory.map((s) => `${s.reason}@${s.timestamp}`).join(' | ');
        lines.push(`  - sessionHistory (${issue.sessionHistory.length}${issue.sessionHistoryTruncated ? ` of ${issue.sessionHistory.length + issue.sessionHistoryTruncated}` : ''}): ${reasons}`);
      }
      if (issue.recoveryTrips.length) {
        lines.push(`  - recoveryTrips: ${issue.recoveryTrips.map((t) => `${t.recoveryPath} x${t.tripCount}${t.open ? ' OPEN' : ''}`).join(' | ')}${issue.recoveryTripsTruncated ? ` (+${issue.recoveryTripsTruncated} more)` : ''}`);
      }
      if (issue.scopeDrift) {
        const d = issue.scopeDrift;
        lines.push(`  - scopeDrift: ${d.outsideDeclaredScope.length} file(s) outside declared scope${d.truncated ? ` (+${d.truncated} more)` : ''}, ${d.declaredScopeUntouched.length} declared-but-untouched`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return applyRenderedByteBudget(blocks);
}

/**
 * Enforce the global size ceiling.
 *
 * Blocks are emitted project-by-project in order, and we stop at the first one
 * that would cross the budget rather than emitting a half-block. What was
 * dropped is always stated, so a truncated snapshot can never be mistaken for a
 * complete one.
 */
function applyRenderedByteBudget(blocks: string[]): string {
  const budget = EVIDENCE_LIMITS.maxRenderedBytes;
  const size = (text: string) => Buffer.byteLength(text, 'utf8');
  // Reserve room for the footer up front. Appending the disclosure after
  // filling to the cap is how the first version of this function overshot its
  // own budget by 90 bytes: the notice explaining the truncation was itself
  // uncounted.
  const footerReserve = 400;
  const fillBudget = budget - footerReserve;

  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  let headTruncated = false;

  for (const block of blocks) {
    const cost = size(block) + 2; // the '\n\n' join
    if (used + cost <= fillBudget) {
      kept.push(block);
      used += cost;
      continue;
    }
    if (kept.length === 0) {
      // A single block bigger than the whole budget still has to fit, so trim
      // it by BYTES (not characters — a char slice is not a byte bound under
      // UTF-8) and say so.
      let head = block;
      while (size(head) > fillBudget && head.length > 1) {
        head = head.slice(0, Math.max(1, Math.floor(head.length * 0.9)));
      }
      kept.push(head);
      used = size(head) + 2;
      headTruncated = true;
      continue;
    }
    dropped++;
  }

  const footer: string[] = [];
  if (headTruncated) {
    footer.push(`this project's evidence exceeded the ${budget}-byte snapshot budget on its own and was cut short`);
  }
  if (dropped > 0) {
    footer.push(`${dropped} further project block(s) were dropped`);
  }
  if (footer.length) {
    kept.push(`[TRUNCATED: ${footer.join('; ')}. The omitted material was NOT examined — do not infer that nothing happened there.]`);
  }
  return kept.join('\n\n');
}

/**
 * Default adapter: the canonical issue-record read door. `listIssueRecords` is
 * that door's bounded enumeration facet and already resolves BOTH layouts —
 * the migrated `<stateRoot>/records/` and the legacy layout, which is
 * issue-workspace scoped (`<project>/.pan/records/` plus every
 * every per-issue workspace's own `.pan/records/` directory). We deliberately do not reimplement
 * that resolution here; reimplementing it is what produced the wrong legacy
 * path in the first place.
 */
export async function listRecordsThroughReadDoor(
  project: RetrospectiveProjectLine,
): Promise<RetrospectiveRecordListing> {
  const config = getProjectSync(project.key);
  if (!config) throw new Error(`project "${project.key}" is not registered`);
  // Detailed form: the array-only facet cannot distinguish "no records" from
  // "the directory could not be read", and a retrospective that reports silence
  // it never actually verified is worse than one that reports a gap.
  const listed = await listIssueRecordsDetailed(config);
  return {
    records: listed.records as unknown as RetrospectiveSourceRecord[],
    failures: listed.failures.map((f) => ({ path: f.path, message: f.message })),
  };
}

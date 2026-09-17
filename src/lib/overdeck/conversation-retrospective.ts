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
import { listIssueRecords } from '../pan-dir/record-list.js';

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
    listRecords?: (project: RetrospectiveProjectLine) => Promise<RetrospectiveSourceRecord[]>;
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

/** A record counts as in-window when its `updated` parses and is at or after the start. */
export function isRecordInWindow(updated: string | undefined, windowStart: Date): 'in' | 'out' | 'undated' {
  if (!updated) return 'undated';
  const parsed = Date.parse(updated);
  if (Number.isNaN(parsed)) return 'undated';
  return parsed >= windowStart.getTime() ? 'in' : 'out';
}

function projectIssueEvidence(record: RetrospectiveSourceRecord): RetrospectiveIssueEvidence {
  const feedback = record.feedback ?? [];
  const sessions = record.sessionHistory ?? [];
  const trips = record.recoveryTrips ?? [];
  const drift = record.scopeDrift;
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
        outsideDeclaredScope: (drift.outsideDeclaredScope ?? []).slice(0, EVIDENCE_LIMITS.maxScopeDriftFiles),
        declaredScopeUntouched: (drift.declaredScopeUntouched ?? []).slice(0, EVIDENCE_LIMITS.maxScopeDriftFiles),
        truncated: Math.max(0, (drift.outsideDeclaredScope ?? []).length - EVIDENCE_LIMITS.maxScopeDriftFiles),
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

export async function collectRetrospectiveEvidence(input: {
  projects: RetrospectiveProjectLine[];
  windowStart: Date;
  /** Injected for tests; defaults to the canonical enumeration read door. */
  listRecords: (project: RetrospectiveProjectLine) => Promise<RetrospectiveSourceRecord[]>;
}): Promise<RetrospectiveProjectEvidence[]> {
  const out: RetrospectiveProjectEvidence[] = [];
  for (const project of input.projects) {
    let records: RetrospectiveSourceRecord[];
    try {
      records = await input.listRecords(project);
    } catch (error) {
      out.push({
        key: project.key,
        issues: [],
        outOfWindow: 0,
        undated: 0,
        truncated: 0,
        unavailable: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    let outOfWindow = 0;
    let undated = 0;
    const kept: RetrospectiveSourceRecord[] = [];
    for (const record of records) {
      if (!record?.issueId) continue;
      const verdict = isRecordInWindow(record.updated, input.windowStart);
      if (verdict === 'out') { outOfWindow++; continue; }
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
    if (project.issues.length === 0) {
      blocks.push(`### ${project.key}\n\nNo issue records were updated in this window (${project.outOfWindow} record(s) fell outside it). No evidence found for this project.`);
      continue;
    }
    const lines = [`### ${project.key}`, ''];
    const notes: string[] = [`${project.issues.length} issue record(s) in window`];
    if (project.outOfWindow) notes.push(`${project.outOfWindow} outside the window (not shown)`);
    if (project.undated) notes.push(`${project.undated} with no usable \`updated\` timestamp (shown, treat their timing as unknown)`);
    if (project.truncated) notes.push(`${project.truncated} dropped by the ${EVIDENCE_LIMITS.maxIssuesPerProject}-issue cap (most recently updated kept)`);
    lines.push(`${notes.join('; ')}.`, '');
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
  return blocks.join('\n\n');
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
): Promise<RetrospectiveSourceRecord[]> {
  const config = getProjectSync(project.key);
  if (!config) throw new Error(`project "${project.key}" is not registered`);
  return (await listIssueRecords(config)) as unknown as RetrospectiveSourceRecord[];
}

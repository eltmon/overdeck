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
import { listProjectsAsync, getProjectSync, getIssuePrefix } from '../projects.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RETROSPECTIVE_WINDOWS = {
  '24h': { label: 'last 24 hours', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: 'last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
} as const;
export type RetrospectiveWindow = keyof typeof RETROSPECTIVE_WINDOWS;
export const DEFAULT_RETROSPECTIVE_WINDOW: RetrospectiveWindow = '24h';

export interface RetrospectiveProjectLine {
  key: string;
  path: string;
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
        `- ${p.key}: repo ${p.path}; github ${p.githubRepo ?? 'none'}`,
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
  return projects.map(({ key, config }) => ({
    key,
    path: config.path,
    githubRepo: config.github_repo,
  }));
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
    ) => Promise<RetrospectiveSourceIssue[] | RetrospectiveRecordListing>;
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

// ─── Evidence bridge ──────────────────────────────────────────────────────────
//
// PAN-3917: the retrospective reads the owners of what happened — the tracker
// for issues, labels and timestamps, the forge for pull requests, reviews and
// checks. The server collects that evidence itself and renders a window-scoped
// snapshot into the kickoff message, rather than telling the conversation to go
// read files off disk.

/** Caps keep the kickoff prompt bounded; anything dropped is disclosed, never silent. */
export const EVIDENCE_LIMITS = {
  maxIssuesPerProject: 40,
  maxFeedbackPerIssue: 10,
  /**
   * Global ceiling on the rendered snapshot. handleConversationCreate caps the
   * whole kickoff message, so an unbounded snapshot does not just bloat the
   * prompt — it can push the message over that cap and lose the instructions
   * too. Per-row caps alone do not bound this: one record with a megabyte of
   * verificationNotes clears every per-row cap.
   */
  maxRenderedBytes: 262_144,
} as const;

/**
 * What one issue did in the window, read from its owners (PAN-3917): the
 * tracker owns the issue and its labels, the forge owns the pull request, its
 * review decision and its checks.
 */
export interface RetrospectiveIssueEvidence {
  issueId: string;
  title?: string;
  updated?: string;
  /** Tracker state: `OPEN` or `CLOSED`. */
  state?: string;
  labels: string[];
  pullRequest?: {
    number: number;
    state: string;
    reviewDecision?: string;
    mergedAt?: string;
    checks?: string;
  };
}

export interface RetrospectiveProjectEvidence {
  key: string;
  issues: RetrospectiveIssueEvidence[];
  /** Records the door returned that fell outside the window. */
  outOfWindow: number;
  /** Records with no usable `updated` timestamp — kept, but flagged as undatable. */
  undated: number;
  /** Issues dated after `now` (clock skew) — excluded, not silently ranked first. */
  future: number;
  /** Trackers or forges this project's evidence could not be read from. */
  unreadable: { path: string; message: string }[];
  /** Issues dropped by the per-project cap. */
  truncated: number;
  /** Populated when the read door itself failed for this project. */
  unavailable?: string;
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

function projectIssueEvidence(issue: RetrospectiveSourceIssue): RetrospectiveIssueEvidence {
  return {
    issueId: issue.issueId,
    title: issue.title,
    updated: issue.updated,
    state: issue.state,
    labels: issue.labels ?? [],
    pullRequest: issue.pullRequest,
  };
}

/** The subset of tracker + forge data this bridge consumes. */
export interface RetrospectiveSourceIssue {
  issueId: string;
  title?: string;
  updated?: string;
  state?: string;
  labels?: string[];
  pullRequest?: {
    number: number;
    state: string;
    reviewDecision?: string;
    mergedAt?: string;
    checks?: string;
  };
}

/** What the read door returns when the caller needs failures as well as issues. */
export interface RetrospectiveRecordListing {
  records: RetrospectiveSourceIssue[];
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
  ) => Promise<RetrospectiveSourceIssue[] | RetrospectiveRecordListing>;
}): Promise<RetrospectiveProjectEvidence[]> {
  const out: RetrospectiveProjectEvidence[] = [];
  for (const project of input.projects) {
    let records: RetrospectiveSourceIssue[];
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
    const kept: RetrospectiveSourceIssue[] = [];
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
      const head = [`updated ${issue.updated ?? 'unknown'}`];
      if (issue.state) head.push(issue.state.toLowerCase());
      lines.push(`- **${issue.issueId}**${issue.title ? ` ${issue.title}` : ''} (${head.join(', ')})`);
      if (issue.labels.length) lines.push(`  - labels: ${issue.labels.join(', ')}`);
      if (issue.pullRequest) {
        const pr = issue.pullRequest;
        const bits = [`#${pr.number} ${pr.state}`];
        if (pr.reviewDecision) bits.push(`review ${pr.reviewDecision}`);
        if (pr.checks) bits.push(`checks ${pr.checks}`);
        if (pr.mergedAt) bits.push(`merged ${pr.mergedAt}`);
        lines.push(`  - pull request: ${bits.join(', ')}`);
      } else {
        lines.push('  - pull request: none');
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
 * Default adapter (PAN-3917): the tracker is the read door. GitHub owns the
 * issues, their labels and their timestamps; the forge owns each issue's pull
 * request, its review decision and its checks. Nothing is stored, so the
 * retrospective can never report a stale copy of what happened.
 *
 * A project with no `github_repo` is reported as unreadable rather than quiet:
 * a retrospective that claims silence it never verified is worse than a gap.
 */
export async function listRecordsThroughReadDoor(
  project: RetrospectiveProjectLine,
): Promise<RetrospectiveRecordListing> {
  const repo = project.githubRepo;
  if (!repo) {
    return {
      records: [],
      failures: [{
        path: project.path,
        message: 'project declares no github_repo, so its tracker could not be queried',
      }],
    };
  }

  const { stdout } = await execFileAsync(
    'gh',
    [
      'issue', 'list',
      '--repo', repo,
      '--state', 'all',
      '--limit', String(EVIDENCE_LIMITS.maxIssuesPerProject),
      '--json', 'number,title,state,updatedAt,labels',
    ],
    { encoding: 'utf-8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  );

  const config = getProjectSync(project.key);
  const prefix = (config ? getIssuePrefix(config) : undefined) ?? project.key.toUpperCase();
  const issues = JSON.parse(stdout) as Array<{
    number: number;
    title?: string;
    state?: string;
    updatedAt?: string;
    labels?: Array<{ name?: string }>;
  }>;

  return {
    records: issues.map((issue) => ({
      issueId: `${prefix}-${issue.number}`,
      title: issue.title,
      updated: issue.updatedAt,
      state: issue.state,
      labels: (issue.labels ?? []).map((label) => label.name).filter((name): name is string => !!name),
    })),
  };
}

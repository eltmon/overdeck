import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Issue, IssueState, TrackerType } from '../tracker/interface.js';
import { getReviewStatusSync } from '../review-status.js';
import { parseSequenceMd } from './sequence-io.js';
import type { SequenceDoc } from './types.js';

export type BacklogManifestEntry = {
  id: string;
  title: string;
  labels: string[];
  priority: number | undefined;
  ageMs: number;
  inPipeline: boolean;
  hasPrd: boolean;
  ready: boolean;
  updatedAt: string;
};

export type BatchedBodyAccessor = {
  count: number;
  getBatch(batchIndex: number, batchSize: number): Array<{ id: string; body: string }>;
};

export type CollectOpenBacklogResult = {
  manifest: BacklogManifestEntry[];
  bodies: BatchedBodyAccessor;
  priorSequence: SequenceDoc | null;
};

const SEQUENCE_MD_PATH = '.pan/backlog/sequence.md';
const CLOSED_STATES = new Set(['closed', 'cancelled']);

/**
 * Map a dashboard canonical status (or a raw tracker status) onto the
 * tracker-library {@link IssueState} union that {@link collectOpenBacklog}
 * expects. Dashboard read-model issues carry `canonicalStatus`/`state` values
 * like `done`/`canceled`/`verifying_on_main`; the backlog library only knows
 * `open`/`in_progress`/`in_review`/`closed`.
 */
function canonicalToIssueState(raw: string): IssueState {
  const c = raw.toLowerCase();
  if (['done', 'closed', 'completed', 'canceled', 'cancelled', 'duplicate', 'wontfix'].includes(c)) return 'closed';
  if (['in_review', 'in review', 'review', 'qa', 'testing'].includes(c)) return 'in_review';
  if (['in_progress', 'in progress', 'started', 'active', 'verifying', 'verifying_on_main', 'verifying on main'].includes(c)) return 'in_progress';
  return 'open'; // backlog, todo, ready, triage, unknown, ''
}

/**
 * Adapt the dashboard read-model issue objects returned by
 * `getSharedIssueService().getIssues()` into tracker-library {@link Issue}
 * objects. The two shapes diverge: the dashboard keys the human ref as
 * `identifier` (e.g. "PAN-302") with no `ref` field, and its `state` is a
 * canonical dashboard status, not an {@link IssueState}. Feeding the raw
 * dashboard objects straight into {@link collectOpenBacklog} made
 * `getReviewStatusSync(issue.ref)` receive `undefined` and crash on
 * `undefined.toUpperCase()` — so every sequencer pass died before spawning.
 *
 * Issues without a usable human ref are dropped (they cannot be ranked).
 */
export function normalizeBacklogIssues(
  raw: ReadonlyArray<Record<string, unknown>>,
): Issue[] {
  const out: Issue[] = [];
  for (const r of raw) {
    const ref = String(r['identifier'] ?? r['ref'] ?? '').trim();
    if (!ref) continue;
    const stateRaw = String(r['canonicalStatus'] ?? r['state'] ?? r['status'] ?? '');
    out.push({
      id: String(r['id'] ?? ref),
      ref,
      title: String(r['title'] ?? ''),
      description: String(r['description'] ?? ''),
      state: canonicalToIssueState(stateRaw),
      labels: Array.isArray(r['labels']) ? (r['labels'] as string[]) : [],
      url: String(r['url'] ?? ''),
      tracker: (typeof r['source'] === 'string' ? r['source'] : 'github') as TrackerType,
      priority: typeof r['priority'] === 'number' ? r['priority'] : undefined,
      createdAt: String(r['createdAt'] ?? ''),
      updatedAt: String(r['updatedAt'] ?? ''),
    });
  }
  return out;
}

export async function collectOpenBacklog(
  projectRoot: string,
  issues: Issue[],
  opts?: {
    hasPrdFn?: (issueId: string) => boolean;
    hasSpecFn?: (issueId: string) => boolean;
  },
): Promise<CollectOpenBacklogResult> {
  const now = Date.now();

  const openIssues = issues.filter((issue) => !CLOSED_STATES.has(issue.state));

  // Build per-issue lookup sets once (filesystem scans are cheap when batched).
  const specsDir = join(projectRoot, '.pan', 'specs');
  const workspacesDir = join(projectRoot, 'workspaces');
  const issuesWithSpecs = new Set<string>();
  const issuesWithBeads = new Set<string>();
  if (!opts?.hasSpecFn) {
    if (existsSync(specsDir)) {
      for (const f of readdirSync(specsDir)) {
        const match = /^[\d-]+-([A-Z]+-\d+)-/i.exec(f);
        if (match) issuesWithSpecs.add(match[1]!.toUpperCase());
      }
    }
    if (existsSync(workspacesDir)) {
      for (const dir of readdirSync(workspacesDir)) {
        const match = /^feature-([a-z]+-\d+)$/i.exec(dir);
        if (match) {
          if (existsSync(join(workspacesDir, dir, '.beads', 'issues.jsonl'))) {
            issuesWithBeads.add(match[1]!.toUpperCase());
          }
        }
      }
    }
  }

  const manifest: BacklogManifestEntry[] = openIssues.map((issue) => {
    const reviewStatus = getReviewStatusSync(issue.ref);
    const inPipeline =
      (reviewStatus !== null && reviewStatus.reviewStatus !== 'pending') ||
      existsSync(join(workspacesDir, `feature-${issue.ref.toLowerCase()}`));

    const hasPrd = opts?.hasPrdFn
      ? opts.hasPrdFn(issue.ref)
      : existsSync(join(projectRoot, '.pan', 'drafts', `${issue.ref.toUpperCase()}.md`));

    const ready = opts?.hasSpecFn
      ? opts.hasSpecFn(issue.ref)
      : (issuesWithSpecs.has(issue.ref.toUpperCase()) &&
         issuesWithBeads.has(issue.ref.toUpperCase()));

    const createdMs = issue.createdAt ? new Date(issue.createdAt).getTime() : now;

    return {
      id: issue.ref,
      title: issue.title,
      labels: issue.labels,
      priority: issue.priority,
      ageMs: now - createdMs,
      inPipeline,
      hasPrd,
      ready,
      updatedAt: issue.updatedAt,
    };
  });

  const bodies: BatchedBodyAccessor = {
    count: openIssues.length,
    getBatch(batchIndex: number, batchSize: number) {
      const start = batchIndex * batchSize;
      const batch = openIssues.slice(start, start + batchSize);
      return batch.map((issue) => ({ id: issue.ref, body: issue.description }));
    },
  };

  const sequencePath = join(projectRoot, SEQUENCE_MD_PATH);
  let priorSequence: SequenceDoc | null = null;
  if (existsSync(sequencePath)) {
    const md = readFileSync(sequencePath, 'utf-8');
    const result = parseSequenceMd(md);
    if (result.ok) {
      priorSequence = result.doc;
    }
  }

  return { manifest, bodies, priorSequence };
}

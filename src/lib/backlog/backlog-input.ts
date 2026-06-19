import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Issue } from '../tracker/interface.js';
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

  const manifest: BacklogManifestEntry[] = openIssues.map((issue) => {
    const reviewStatus = getReviewStatusSync(issue.ref);
    const inPipeline =
      reviewStatus !== null && reviewStatus.reviewStatus !== 'pending';

    const hasPrd = opts?.hasPrdFn
      ? opts.hasPrdFn(issue.ref)
      : existsSync(join(projectRoot, '.pan', 'drafts', `${issue.ref.toUpperCase()}.md`));

    const ready = opts?.hasSpecFn
      ? opts.hasSpecFn(issue.ref)
      : existsSync(join(projectRoot, '.pan', 'specs'));

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

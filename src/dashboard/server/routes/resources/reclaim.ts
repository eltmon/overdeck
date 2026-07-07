import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getReviewStatusSync } from '../../../../lib/review-status.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import type { ResourceStack } from './stacks.js';

export type ReclaimCandidateKind = 'stack' | 'venv' | 'docker-prune' | 'exited-container';

export interface ReclaimCandidate {
  kind: ReclaimCandidateKind;
  label: string;
  why: string;
  ramBytes: number;
  diskBytes: number;
  action: string;
  issueId?: string;
}

export interface ReclaimPayload {
  reclaimCandidates: ReclaimCandidate[];
  reclaimTotals: {
    ramBytes: number;
    diskBytes: number;
  };
  reclaimThresholdBytes: number;
}

export interface ReclaimAgentLike {
  issueId?: string | null;
  hasLiveTmuxSession?: boolean;
}

export interface ReclaimVenvCandidate {
  issueId: string;
  path: string;
  diskBytes: number;
}

const RECLAIM_THRESHOLD_BYTES = 500 * 1024 ** 2;
const VENV_THRESHOLD_BYTES = 1024 ** 3;

let cachedVenvCandidates: ReclaimVenvCandidate[] = [];
let venvDelete: (path: string) => Promise<void> = async (path) => {
  await rm(path, { recursive: true, force: true });
};
let issueClosedReader: (issueId: string) => boolean = (issueId) => isClosedReviewStatus(issueId);
let projectRootReader: () => string = () => resolve(process.cwd(), '..', '..');

export function buildReclaimPayload(
  stacks: ResourceStack[],
  agents: ReclaimAgentLike[],
  options: { venvs?: ReclaimVenvCandidate[] } = {},
): ReclaimPayload {
  const liveIssueIds = new Set(
    agents
      .filter((agent) => agent.hasLiveTmuxSession === true)
      .map((agent) => agent.issueId?.toUpperCase())
      .filter((issueId): issueId is string => Boolean(issueId)),
  );

  const candidates: ReclaimCandidate[] = [
    ...stacks
      .filter((stack) => stack.issueId && isClosedStack(stack) && !liveIssueIds.has(stack.issueId.toUpperCase()))
      .map((stack): ReclaimCandidate => ({
        kind: 'stack',
        label: stack.issueId ?? stack.composeProject,
        why: 'Issue is merged or closed and no live agent references it.',
        ramBytes: stack.aggregates.memoryBytes,
        diskBytes: stack.aggregates.diskBytes,
        action: `GET /api/resources/stacks/${stack.issueId}/teardown-estimate`,
        issueId: stack.issueId ?? undefined,
      })),
    ...(options.venvs ?? cachedVenvCandidates)
      .filter((venv) => venv.diskBytes >= VENV_THRESHOLD_BYTES && issueClosedReader(venv.issueId))
      .map((venv): ReclaimCandidate => ({
        kind: 'venv',
        label: `${venv.issueId} virtualenv`,
        why: 'Closed issue has an orphaned workspace .venv over 1 GB.',
        ramBytes: 0,
        diskBytes: venv.diskBytes,
        action: `DELETE /api/resources/venvs/${venv.issueId}`,
        issueId: venv.issueId,
      })),
  ];

  return {
    reclaimCandidates: candidates,
    reclaimTotals: {
      ramBytes: candidates.reduce((sum, candidate) => sum + candidate.ramBytes, 0),
      diskBytes: candidates.reduce((sum, candidate) => sum + candidate.diskBytes, 0),
    },
    reclaimThresholdBytes: RECLAIM_THRESHOLD_BYTES,
  };
}

export function setReclaimVenvCandidatesForTests(candidates: ReclaimVenvCandidate[]): void {
  cachedVenvCandidates = candidates.map((candidate) => ({ ...candidate }));
}

export function setReclaimIssueClosedReaderForTests(reader: (issueId: string) => boolean): void {
  issueClosedReader = reader;
}

export function setReclaimVenvDeleteForTests(deleteFn: (path: string) => Promise<void>): void {
  venvDelete = deleteFn;
}

export function setReclaimProjectRootForTests(projectRoot: string): void {
  projectRootReader = () => projectRoot;
}

export function resetReclaimForTests(): void {
  cachedVenvCandidates = [];
  venvDelete = async (path) => {
    await rm(path, { recursive: true, force: true });
  };
  issueClosedReader = (issueId) => isClosedReviewStatus(issueId);
  projectRootReader = () => resolve(process.cwd(), '..', '..');
}

export const deleteResourceVenvRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/venvs/:issue',
  httpHandler(Effect.gen(function* () {
    const params = (yield* HttpRouter.schemaParams<{ issue: string }>()) as { issue: string };
    return yield* deleteResourceVenvEffect(params.issue);
  })),
);

export function deleteResourceVenvEffect(issue: string): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return Effect.gen(function* () {
    const issueId = issue.toUpperCase();
    if (!issueClosedReader(issueId)) {
      return jsonResponse({ ok: false, error: `${issueId} is not closed; refusing to delete workspace venv.` }, { status: 409 });
    }
    const venvPath = join(projectRootReader(), 'workspaces', `feature-${issueId.toLowerCase()}`, '.venv');
    yield* Effect.tryPromise({
      try: () => venvDelete(venvPath),
      catch: (error) => error,
    }).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    return jsonResponse({ ok: true, issueId, path: venvPath });
  });
}

function isClosedStack(stack: ResourceStack): boolean {
  return stack.phase === 'merged';
}

function isClosedReviewStatus(issueId: string): boolean {
  const status = getReviewStatusSync(issueId);
  return status?.mergeStatus === 'merged';
}

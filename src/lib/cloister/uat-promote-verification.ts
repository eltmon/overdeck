import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { rehydrateHeadAnchor } from '../git-utils.js';
import { listUatGenerationsSync } from '../overdeck/merge-sync.js';
import type { UatGeneration, UatGenerationMember } from '../overdeck/merge-types.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import type { ReviewStatus } from '../review-status.js';
import type { ReviewStatusUpdate } from '../workspace-anchor-drift.js';

const execFileAsync = promisify(execFile);

export interface UatPromotionEvidence {
  generationName: string;
  mergeSha?: string;
}

/** Build the verification verdict recorded when an operator promotes a tested UAT batch. */
export function buildUatPromotionStamp(
  current: Pick<ReviewStatus, 'verificationStatus'> | null,
  member: UatGenerationMember,
  evidence: UatPromotionEvidence,
): ReviewStatusUpdate {
  if (current?.verificationStatus === 'passed' || current?.verificationStatus === 'skipped') {
    return {};
  }

  const shortSha = evidence.mergeSha?.slice(0, 9);
  const promotedAt = shortSha ? ` promoted to main at ${shortSha}` : ' promoted to main';
  return {
    verificationStatus: 'passed',
    verificationNotes: `uat-promotion: operator UAT of batch ${evidence.generationName}${promotedAt} (PAN-3114)`,
    ...(member.headSha ? { lastVerifiedCommit: rehydrateHeadAnchor(member.headSha) } : {}),
  };
}

/** Record UAT-promotion verification verdicts through the review-status write door. */
export function recordUatPromotionVerdicts(gen: UatGeneration, mergeSha: string): string[] {
  const stampedIssueIds: string[] = [];

  for (const member of gen.members) {
    const current = getReviewStatusSync(member.issueId);
    const stamp = buildUatPromotionStamp(current, member, {
      generationName: gen.name,
      mergeSha,
    });
    if (Object.keys(stamp).length === 0) continue;

    setReviewStatusSync(member.issueId, stamp, current ?? undefined);
    stampedIssueIds.push(member.issueId);
    console.log(`✓ Recorded UAT-promotion verification verdict for ${member.issueId} (${gen.name} at ${mergeSha.slice(0, 9)})`);
  }

  return stampedIssueIds;
}

export interface UatPromotionHealDeps {
  resolveProject(issueId: string): { projectPath: string } | null;
  listGenerations(options: { projectRoot: string; statuses: readonly ['promoted'] }): UatGeneration[];
  getReviewStatus(issueId: string): ReviewStatus | null;
  setReviewStatus(issueId: string, update: ReviewStatusUpdate, existing?: ReviewStatus): ReviewStatus;
  findMergeSha(projectRoot: string, generationName: string): Promise<string | undefined>;
}

async function findUatPromotionMergeSha(
  projectRoot: string,
  generationName: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', [
      'log',
      '--fixed-strings',
      `--grep=Merge UAT batch ${generationName}`,
      '--format=%H',
      '-1',
      'origin/main',
    ], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_HEAL_DEPS: UatPromotionHealDeps = {
  resolveProject: resolveProjectFromIssueSync,
  listGenerations: listUatGenerationsSync,
  getReviewStatus: getReviewStatusSync,
  setReviewStatus: setReviewStatusSync,
  findMergeSha: findUatPromotionMergeSha,
};

/** Restore discarded UAT-promotion evidence for a member of a previously promoted batch. */
export async function healUatPromotionVerification(
  issueId: string,
  deps: UatPromotionHealDeps = DEFAULT_HEAL_DEPS,
): Promise<{ generation: string; mergeSha?: string } | null> {
  const project = deps.resolveProject(issueId);
  if (!project) return null;

  const generation = deps.listGenerations({
    projectRoot: project.projectPath,
    statuses: ['promoted'],
  })
    .filter((candidate) => candidate.members.some((member) => member.issueId === issueId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!generation) return null;

  const member = generation.members.find((candidate) => candidate.issueId === issueId)!;
  const current = deps.getReviewStatus(issueId);
  if (current?.verificationStatus === 'passed' || current?.verificationStatus === 'skipped') {
    return null;
  }

  const mergeSha = await deps.findMergeSha(project.projectPath, generation.name).catch(() => undefined);
  const stamp = buildUatPromotionStamp(current, member, {
    generationName: generation.name,
    mergeSha,
  });
  deps.setReviewStatus(issueId, stamp, current ?? undefined);

  return {
    generation: generation.name,
    ...(mergeSha ? { mergeSha } : {}),
  };
}

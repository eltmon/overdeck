/**
 * PAN-4531: when a verification run's outcome is already decided, it must stop
 * before its next local gate asks for the single CPU admission slot
 * (cloister/quality-gate-admission.ts). Decided means, in this order:
 *
 * 1. the PR merged (the existing merged skip);
 * 2. the agent committed past the head under verification — review
 *    verification only, by the one same-head rule in verification-head.ts;
 * 3. in `ci` tests mode, the CI test job for the verified head is red.
 *
 * The runner asks before its first local gate, before each quality gate, and
 * once after the last one. See docs/PIPELINE-GATES.md.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { snapshotWorkspaceHeads, type HeadAnchor } from '../git-utils.js';
import type { WorkspaceRepoRoot } from '../project-repos.js';
import { readLatestCiTestResult } from './verification-cycles.js';
import { skipMergedVerification } from './verification-escalation.js';
import { classifyVerificationHead, isSameVerificationHead, type VerificationHeadRelation } from './verification-head.js';
import type { VerificationRunnerOutcome } from './verification-types.js';

const execAsync = promisify(exec);

/** The workspace's current HEAD, eight chars, or undefined when git cannot say. */
export async function readWorkspaceHeadShort(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * PAN-4527: where HEAD stands against the launch head, and the eight-char head
 * a verdict belongs to: the launch head while HEAD is still that head or the
 * worker's own sync merge of it, otherwise the workspace's current HEAD.
 */
export async function readVerifiedHead(
  repoRoots: WorkspaceRepoRoot[],
  launchHead: HeadAnchor | undefined,
  launchHeadShort: string | undefined,
  issueId: string,
  workspacePath: string,
): Promise<{ relation: VerificationHeadRelation; short: string | undefined }> {
  const relation = await classifyVerificationHead(repoRoots, launchHead, await snapshotWorkspaceHeads(issueId, workspacePath));
  if (isSameVerificationHead(relation)) return { relation, short: launchHeadShort };
  return { relation, short: (await readWorkspaceHeadShort(workspacePath)) ?? launchHeadShort };
}

/** Why a run stopped before its remaining local gates. */
export type DecidedStop =
  | { kind: 'merged'; outcome: VerificationRunnerOutcome }
  | { kind: 'superseded'; head: string | undefined }
  | { kind: 'ci-red' };

export interface DecidedStopCheck {
  /** Re-check until a stop is found; once decided, stays decided. */
  isDecided(): Promise<boolean>;
  readonly stop: DecidedStop | undefined;
}

export function createDecidedStopCheck(input: {
  issueId: string;
  workspacePath: string;
  logPrefix: string;
  repoRoots: WorkspaceRepoRoot[];
  launchHead: HeadAnchor | undefined;
  launchHeadShort: string | undefined;
  testsMode: 'ci' | 'local';
  /** Merge verification never syncs and owns its workspace, so it is never superseded. */
  checkSuperseded: boolean;
}): DecidedStopCheck {
  let stop: DecidedStop | undefined;
  return {
    get stop() { return stop; },
    async isDecided() {
      if (stop) return true;
      const merged = await skipMergedVerification(input.issueId, input.logPrefix, input.workspacePath);
      if (merged) {
        stop = { kind: 'merged', outcome: merged };
        return true;
      }
      const verified = await readVerifiedHead(input.repoRoots, input.launchHead, input.launchHeadShort, input.issueId, input.workspacePath);
      if (input.checkSuperseded && verified.relation === 'moved') {
        stop = { kind: 'superseded', head: verified.short };
      } else if (input.testsMode === 'ci' && readLatestCiTestResult(input.workspacePath, verified.short) === 'failed') {
        stop = { kind: 'ci-red' };
      }
      return stop !== undefined;
    },
  };
}

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultRunWorkspace } from './spawn-prep.js';
import { resolveWorkspaceRepoRootsSync, type WorkspaceRepoRoot } from '../project-repos.js';
import type { XBriefItem } from '../xbrief/types.js';

const execAsync = promisify(exec);

export interface SlotMergeIssue {
  issueId: string;
  featureWorkspace?: string;
  slotBranch?: string;
  slotWorkspace?: string;
}

export interface SlotMergeEvidence {
  verifyCommands: string[];
  expectedOutputs: string[];
  commandOutputs: Array<{ command: string; stdout: string; stderr: string }>;
  mergeOutput?: { stdout: string; stderr: string };
  /** Per-repo merge outputs for polyrepo slots (one entry per nested repo merged). */
  repoMergeOutputs?: Array<{ repoKey: string; stdout: string; stderr: string }>;
}

export interface SlotMergeResult {
  verified: boolean;
  merged: boolean;
  conflicts: boolean;
  evidence: SlotMergeEvidence;
  failure?: string;
}

export interface SlotMergeDeps {
  run: (command: string, cwd: string) => Promise<{ stdout: string; stderr: string }>;
  /** Polyrepo-aware repo roots for a workspace path. Defaults to the canonical resolver. */
  resolveRepoRoots: (issueId: string, workspacePath: string) => WorkspaceRepoRoot[];
}

export interface SlotMergeOptions {
  deps?: Partial<SlotMergeDeps>;
}

export async function verifyAndMergeSlot(
  issue: string | SlotMergeIssue,
  slotIndex: number,
  item: XBriefItem,
  options: SlotMergeOptions = {},
): Promise<SlotMergeResult> {
  const issueId = typeof issue === 'string' ? issue : issue.issueId;
  const featureWorkspace = typeof issue === 'string'
    ? defaultRunWorkspace(issue)
    : issue.featureWorkspace ?? defaultRunWorkspace(issue.issueId);
  const slotWorkspace = typeof issue === 'string' ? `${featureWorkspace}-slot-${slotIndex}` : issue.slotWorkspace ?? `${featureWorkspace}-slot-${slotIndex}`;
  const slotBranch = typeof issue === 'string' ? `feature/${issueId.toLowerCase()}-slot-${slotIndex}` : issue.slotBranch ?? `feature/${issueId.toLowerCase()}-slot-${slotIndex}`;
  const deps: SlotMergeDeps = {
    run: async (command, cwd) => execAsync(command, { cwd }),
    resolveRepoRoots: resolveWorkspaceRepoRootsSync,
    ...options.deps,
  };
  const verifyCommands = item.metadata?.verify_commands ?? [];
  const expectedOutputs = item.metadata?.expected_outputs ?? [];
  const evidence: SlotMergeEvidence = {
    verifyCommands,
    expectedOutputs,
    commandOutputs: [],
  };

  if (!Number.isInteger(slotIndex) || slotIndex < 1) {
    return { verified: false, merged: false, conflicts: false, evidence, failure: `Invalid slot index: ${slotIndex}` };
  }
  if (verifyCommands.length === 0) {
    return { verified: false, merged: false, conflicts: false, evidence, failure: `Item ${item.id} has no verify_commands` };
  }
  if (expectedOutputs.length === 0) {
    return { verified: false, merged: false, conflicts: false, evidence, failure: `Item ${item.id} has no expected_outputs` };
  }

  for (const command of verifyCommands) {
    try {
      const output = await deps.run(command, slotWorkspace);
      evidence.commandOutputs.push({ command, stdout: output.stdout, stderr: output.stderr });
    } catch (error) {
      const failed = commandFailure(error);
      evidence.commandOutputs.push({ command, stdout: failed.stdout, stderr: failed.stderr });
      return {
        verified: false,
        merged: false,
        conflicts: false,
        evidence,
        failure: `Verify command failed for ${item.id}: ${command}`,
      };
    }
  }

  // PAN-3691: never report a merge when the slot branch carries no unmerged
  // current-item work. Count base..slot commits per real repo root (the
  // polyrepo wrapper is excluded by the resolver, so outer bookkeeping/setup
  // commits cannot satisfy the gate). A zero total means either a fresh slot
  // whose agent died before committing, or a slot branch reused after its
  // earlier work already merged — both must surface, not complete silently.
  const slotRoots = deps.resolveRepoRoots(issueId, slotWorkspace);
  if (slotRoots.some(root => root.degradedPolyrepo)) {
    return {
      verified: true,
      merged: false,
      conflicts: false,
      evidence,
      failure: `Could not resolve polyrepo roots for slot ${slotIndex} — refusing to infer a merge`,
    };
  }
  const aheadByRepo = new Map<string, number>();
  for (const root of slotRoots) {
    aheadByRepo.set(root.repoKey, await aheadCount(deps.run, root.dir, root.sourceBranch, slotBranch));
  }
  const rootsWithWork = slotRoots.filter(root => (aheadByRepo.get(root.repoKey) ?? 0) > 0);
  if (rootsWithWork.length === 0) {
    return {
      verified: true,
      merged: false,
      conflicts: false,
      evidence,
      failure: `Slot branch ${slotBranch} has no unmerged current-item changes in any repo — refusing to mark item ${item.id} merged`,
    };
  }

  const isPolyrepo = slotRoots.some(root => root.isPolyrepo);
  if (!isPolyrepo) {
    try {
      const mergeOutput = await deps.run(`git merge --no-ff ${JSON.stringify(slotBranch)}`, featureWorkspace);
      evidence.mergeOutput = mergeOutput;
      return { verified: true, merged: true, conflicts: false, evidence };
    } catch (error) {
      const failed = commandFailure(error);
      evidence.mergeOutput = { stdout: failed.stdout, stderr: failed.stderr };
      await deps.run('git merge --abort', featureWorkspace).catch(() => {});
      return {
        verified: true,
        merged: false,
        conflicts: true,
        evidence,
        failure: `Slot branch ${slotBranch} did not merge cleanly`,
      };
    }
  }

  // Polyrepo: the wrapper holds no slot branch. Merge each nested slot branch
  // into its feature-branch checkout inside the base feature workspace.
  const baseRoots = new Map(
    deps.resolveRepoRoots(issueId, featureWorkspace).map(root => [root.repoKey, root]),
  );
  const repoMergeOutputs: Array<{ repoKey: string; stdout: string; stderr: string }> = [];
  for (const root of rootsWithWork) {
    const baseRoot = baseRoots.get(root.repoKey);
    if (!baseRoot) {
      return {
        verified: true,
        merged: false,
        conflicts: false,
        evidence: { ...evidence, repoMergeOutputs },
        failure: `No base feature-workspace checkout for repo ${root.repoKey} — cannot integrate slot ${slotIndex}`,
      };
    }
    try {
      const output = await deps.run(`git merge --no-ff ${JSON.stringify(slotBranch)}`, baseRoot.dir);
      repoMergeOutputs.push({ repoKey: root.repoKey, stdout: output.stdout, stderr: output.stderr });
    } catch (error) {
      const failed = commandFailure(error);
      repoMergeOutputs.push({ repoKey: root.repoKey, stdout: failed.stdout, stderr: failed.stderr });
      await deps.run('git merge --abort', baseRoot.dir).catch(() => {});
      return {
        verified: true,
        merged: false,
        conflicts: true,
        evidence: { ...evidence, repoMergeOutputs },
        failure: `Slot branch ${slotBranch} did not merge cleanly into ${root.repoKey}`,
      };
    }
  }
  return { verified: true, merged: true, conflicts: false, evidence: { ...evidence, repoMergeOutputs } };
}

/** Count base..branch commits in one repo; a missing branch or repo means zero. */
async function aheadCount(
  run: SlotMergeDeps['run'],
  cwd: string,
  baseBranch: string,
  branch: string,
): Promise<number> {
  try {
    const { stdout } = await run(
      `git rev-list --count ${JSON.stringify(baseBranch)}..${JSON.stringify(branch)}`,
      cwd,
    );
    const count = Number(stdout.trim());
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

function commandFailure(error: unknown): { stdout: string; stderr: string } {
  const partial = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return {
    stdout: typeof partial.stdout === 'string' ? partial.stdout : '',
    stderr: typeof partial.stderr === 'string'
      ? partial.stderr
      : typeof partial.message === 'string'
        ? partial.message
        : String(error),
  };
}

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultRunWorkspace } from './spawn-prep.js';
import type { VBriefItem } from '../vbrief/types.js';

const execAsync = promisify(exec);

export interface SlotMergeIssue {
  issueId: string;
  featureWorkspace?: string;
}

export interface SlotMergeEvidence {
  verifyCommands: string[];
  expectedOutputs: string[];
  commandOutputs: Array<{ command: string; stdout: string; stderr: string }>;
  mergeOutput?: { stdout: string; stderr: string };
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
}

export interface SlotMergeOptions {
  deps?: Partial<SlotMergeDeps>;
}

export async function verifyAndMergeSlot(
  issue: string | SlotMergeIssue,
  slotIndex: number,
  item: VBriefItem,
  options: SlotMergeOptions = {},
): Promise<SlotMergeResult> {
  const issueId = typeof issue === 'string' ? issue : issue.issueId;
  const featureWorkspace = typeof issue === 'string'
    ? defaultRunWorkspace(issue)
    : issue.featureWorkspace ?? defaultRunWorkspace(issue.issueId);
  const slotWorkspace = `${featureWorkspace}-slot-${slotIndex}`;
  const slotBranch = `feature/${issueId.toLowerCase()}-slot-${slotIndex}`;
  const deps: SlotMergeDeps = {
    run: async (command, cwd) => execAsync(command, { cwd }),
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

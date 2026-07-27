import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { createActiveSlice } from '../xbrief/dag.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import type { RegisteredSlotSpawn } from './spawn-prep.js';

const execAsync = promisify(exec);

export function buildRegisteredSlotPrompt(
  issueId: string,
  baseWorkspace: string,
  slot: RegisteredSlotSpawn,
  extraPrompt?: string,
): string {
  const doc = readWorkspacePlanSync(baseWorkspace);
  if (!doc) {
    throw new Error(
      `Registered slot spawn for ${issueId} requires a readable xBRIEF plan in ${baseWorkspace}.`,
    );
  }

  const slice = createActiveSlice(doc, {
    issueId: issueId.toUpperCase(),
    itemId: slot.slotItemId,
    currentItemIds: [slot.slotItemId],
  });
  const lines = [
    `# Registered Slot Assignment: ${slot.slotItemId}`,
    '',
    `Issue: ${issueId}`,
    `Slot: ${slot.slotIndex}`,
    `Agent: ${slot.agentId}`,
    `Branch: ${slot.branch}`,
    `Workspace: ${slot.workspace}`,
    '',
    'You are a registered slot work agent. Implement only the target xBRIEF item below, keep changes scoped to that item, and do not merge this slot branch yourself.',
    '',
    slice.prompt,
  ];
  const trimmedExtra = extraPrompt?.trim();
  if (trimmedExtra) lines.push('', '## Additional Foreman Instructions', trimmedExtra);
  return lines.join('\n');
}

export async function ensureRegisteredSlotWorktree(baseWorkspace: string, slot: RegisteredSlotSpawn): Promise<void> {
  if (existsSync(slot.workspace)) return;
  await mkdir(dirname(slot.workspace), { recursive: true });
  const branchExists = await gitBranchExists(baseWorkspace, slot.branch);
  const target = JSON.stringify(slot.workspace);
  const branch = JSON.stringify(slot.branch);
  const command = branchExists
    ? `git worktree add ${target} ${branch}`
    : `git worktree add -b ${branch} ${target} HEAD`;
  await execAsync(command, { cwd: baseWorkspace });
}

async function gitBranchExists(workspace: string, branch: string): Promise<boolean> {
  try {
    await execAsync(`git show-ref --verify --quiet ${JSON.stringify(`refs/heads/${branch}`)}`, { cwd: workspace });
    return true;
  } catch {
    return false;
  }
}

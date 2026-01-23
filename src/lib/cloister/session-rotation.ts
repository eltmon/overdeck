/**
 * Session Rotation for Specialists
 *
 * Manages context rotation for long-running specialist agents (like merge-agent)
 * when token usage exceeds thresholds. Preserves essential memory while clearing
 * accumulated context.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { PANOPTICON_HOME } from '../paths.js';
import { getRuntimeForAgent } from '../runtimes/index.js';
import { getAgentState } from '../agents.js';
import type { SpecialistType } from './specialists.js';
import { getTmuxSessionName } from './specialists.js';

/**
 * Token threshold for triggering session rotation
 */
export const SESSION_ROTATION_THRESHOLD = 100_000;

/**
 * Tiered memory configuration
 */
export interface MemoryTiers {
  recent_summary: number; // Most recent N merges with hash + message only
  recent_detailed: number; // Next N merges with more detail
  recent_full: number; // Last N merges with full diffs
}

/**
 * Default memory tiers for merge-agent
 */
export const DEFAULT_MEMORY_TIERS: MemoryTiers = {
  recent_summary: 100, // Last 100 merges: hash + message
  recent_detailed: 50, // Last 50 merges: more details
  recent_full: 20, // Last 20 merges: full diffs
};

/**
 * Merge record for memory file
 *
 * Note: Only core fields (hash, message, author, date, branch) are stored.
 * Files changed and diffs are computed on-demand when building memory
 * to avoid storing large amounts of redundant data.
 */
interface MergeRecord {
  hash: string;
  message: string;
  author?: string;
  date?: string;
  branch?: string;
}

/**
 * Session rotation result
 */
export interface SessionRotationResult {
  success: boolean;
  oldSessionId: string;
  newSessionId?: string;
  memoryFile?: string;
  error?: string;
}

/**
 * Check if an agent needs session rotation
 *
 * @param agentId - Agent ID
 * @returns True if session should be rotated
 */
export function needsSessionRotation(agentId: string): boolean {
  const runtime = getRuntimeForAgent(agentId);
  if (!runtime) return false;

  const tokenUsage = runtime.getTokenUsage(agentId);
  if (!tokenUsage) return false;

  const totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
  return totalTokens >= SESSION_ROTATION_THRESHOLD;
}

/**
 * Build tiered memory file for merge-agent
 *
 * Extracts merge history from git and creates a memory file with
 * tiered detail levels (summary → detailed → full diffs).
 *
 * @param workingDir - Git repository directory
 * @param tiers - Memory tier configuration
 * @returns Memory content as string
 */
export function buildMergeAgentMemory(
  workingDir: string,
  tiers: MemoryTiers = DEFAULT_MEMORY_TIERS
): string {
  const merges: MergeRecord[] = [];

  try {
    // Get recent merge commits
    const totalMerges = Math.max(tiers.recent_summary, tiers.recent_detailed, tiers.recent_full);
    const gitLog = execSync(
      `git log --merges --format="%H|%s|%an|%ad|%D" -n ${totalMerges}`,
      { cwd: workingDir, encoding: 'utf-8' }
    );

    const lines = gitLog.trim().split('\n').filter(l => l);
    for (const line of lines) {
      const [hash, message, author, date, refs] = line.split('|');
      const branch = refs
        ? refs.split(',').find(r => r.includes('feature/') || r.includes('HEAD'))
        : undefined;

      merges.push({ hash, message, author, date, branch });
    }
  } catch (error) {
    console.error('Failed to get merge history:', error);
    return 'No merge history available.\n';
  }

  // Build memory content with tiers
  let memory = '# Merge-Agent Session Memory\n\n';
  memory += `This session was rotated due to context limits. Below is a summary of recent merge activity.\n\n`;

  // Tier 3: Full diffs for most recent merges
  memory += `## Recent Merges (Full Detail)\n\n`;
  memory += `Last ${tiers.recent_full} merges with full diffs:\n\n`;

  for (let i = 0; i < Math.min(tiers.recent_full, merges.length); i++) {
    const merge = merges[i];
    memory += `### ${merge.hash.substring(0, 8)} - ${merge.message}\n`;
    memory += `- Author: ${merge.author}\n`;
    memory += `- Date: ${merge.date}\n`;
    if (merge.branch) memory += `- Branch: ${merge.branch}\n`;

    try {
      // Get files changed
      const files = execSync(`git show --name-only --format= ${merge.hash}`, {
        cwd: workingDir,
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(f => f);

      memory += `- Files changed: ${files.length}\n`;

      // Get diff (limited to avoid huge memory files)
      const diff = execSync(`git show ${merge.hash} --stat`, {
        cwd: workingDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      memory += `\n\`\`\`diff\n${diff.substring(0, 5000)}\n\`\`\`\n\n`;
    } catch (error) {
      memory += `- (Error getting details)\n\n`;
    }
  }

  // Tier 2: Detailed info for next N merges
  if (merges.length > tiers.recent_full) {
    memory += `## Additional Recent Merges (Summary)\n\n`;
    memory += `Merges ${tiers.recent_full + 1} to ${Math.min(tiers.recent_detailed, merges.length)}:\n\n`;

    for (
      let i = tiers.recent_full;
      i < Math.min(tiers.recent_detailed, merges.length);
      i++
    ) {
      const merge = merges[i];
      memory += `- \`${merge.hash.substring(0, 8)}\` ${merge.message} (${merge.author}, ${merge.date})\n`;
    }
    memory += '\n';
  }

  // Tier 1: Hash + message for oldest merges
  if (merges.length > tiers.recent_detailed) {
    memory += `## Older Merges (Hash + Message Only)\n\n`;
    memory += `Merges ${tiers.recent_detailed + 1} to ${merges.length}:\n\n`;

    for (let i = tiers.recent_detailed; i < merges.length; i++) {
      const merge = merges[i];
      memory += `- \`${merge.hash.substring(0, 8)}\` ${merge.message}\n`;
    }
    memory += '\n';
  }

  return memory;
}

/**
 * Rotate a specialist agent's session
 *
 * Kills current session, builds memory file, and starts fresh session with memory.
 *
 * @param specialistName - Specialist name
 * @param workingDir - Working directory (for building memory)
 * @returns Rotation result
 */
export async function rotateSpecialistSession(
  specialistName: SpecialistType,
  workingDir?: string
): Promise<SessionRotationResult> {
  const agentId = `specialist-${specialistName}`;
  const runtime = getRuntimeForAgent(agentId);

  if (!runtime) {
    return {
      success: false,
      oldSessionId: '',
      error: `No runtime found for ${agentId}`,
    };
  }

  const agentState = getAgentState(agentId);
  if (!agentState?.sessionId) {
    return {
      success: false,
      oldSessionId: '',
      error: `No session ID found for ${agentId}`,
    };
  }

  const oldSessionId = agentState.sessionId;

  try {
    // Build memory file (for merge-agent, extract git history)
    let memoryContent = '';
    let memoryFile: string | undefined;

    if (specialistName === 'merge-agent' && workingDir) {
      memoryContent = buildMergeAgentMemory(workingDir);
      memoryFile = join(PANOPTICON_HOME, `merge-agent-memory-${Date.now()}.md`);
      writeFileSync(memoryFile, memoryContent);
      console.log(`Built memory file: ${memoryFile}`);
    }

    // Kill current session
    const tmuxSession = getTmuxSessionName(specialistName);
    try {
      execSync(`tmux kill-session -t "${tmuxSession}"`, { encoding: 'utf-8' });
      console.log(`Killed session: ${tmuxSession}`);
    } catch (error) {
      // Session might already be dead
      console.log(`Session ${tmuxSession} not found or already killed`);
    }

    // Start fresh session with memory
    const prompt = memoryContent
      ? `You are resuming from a rotated session. Here's your memory:\n\n${memoryContent}\n\nContinue from where you left off.`
      : 'Session rotated. Continue from where you left off.';

    const newAgent = runtime.spawnAgent({
      agentId,
      workspace: agentState.workspace,
      prompt,
      runtime: runtime.name,
    });

    console.log(`Started fresh session: ${newAgent.sessionId.substring(0, 8)}`);

    return {
      success: true,
      oldSessionId,
      newSessionId: newAgent.sessionId,
      memoryFile,
    };
  } catch (error: unknown) {
    return {
      success: false,
      oldSessionId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if rotation is needed and perform it
 *
 * @param specialistName - Specialist name
 * @param workingDir - Working directory
 * @returns Rotation result if rotated, null if not needed
 */
export async function checkAndRotateIfNeeded(
  specialistName: SpecialistType,
  workingDir?: string
): Promise<SessionRotationResult | null> {
  const agentId = `specialist-${specialistName}`;

  if (!needsSessionRotation(agentId)) {
    return null;
  }

  console.log(`🔔 Session rotation needed for ${specialistName}`);
  return rotateSpecialistSession(specialistName, workingDir);
}

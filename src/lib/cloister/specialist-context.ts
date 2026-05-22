/**
 * Specialist Context Management
 *
 * Generates and manages AI-powered context digests from recent specialist runs.
 * These digests seed new specialist sessions with learned patterns and expertise.
 *
 * Directory structure:
 *   ~/.panopticon/specialists/{projectKey}/{specialistType}/context/latest-digest.md
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { getPanopticonHome } from '../paths.js';
import { getClaudePermissionFlagsStringSync } from '../claude-permissions.js';
import type { RunLogEntry } from './specialist-logs.js';
import { getProjectSync } from '../projects.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../config-yaml.js';

function execAsync(command: string, options: { encoding: 'utf-8'; maxBuffer: number; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout = '', stderr = '') => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/** Get specialists directory (lazy to support test env overrides) */
function getSpecialistsDir(): string {
  return join(getPanopticonHome(), 'specialists');
}

/**
 * Get the context directory for a project's specialist
 */
export function getContextDirectory(projectKey: string, specialistType: string): string {
  return join(getSpecialistsDir(), projectKey, specialistType, 'context');
}

/**
 * Get the path to the latest context digest file
 */
export function getContextDigestPath(projectKey: string, specialistType: string): string {
  const contextDir = getContextDirectory(projectKey, specialistType);
  return join(contextDir, 'latest-digest.md');
}

/**
 * Ensure context directory exists for a project's specialist
 */
function ensureContextDirectory(projectKey: string, specialistType: string): void {
  const contextDir = getContextDirectory(projectKey, specialistType);
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }
}

/**
 * Load the context digest for a specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @returns Context digest content or null if not found
 */
export function loadContextDigest(projectKey: string, specialistType: string): string | null {
  const digestPath = getContextDigestPath(projectKey, specialistType);

  if (!existsSync(digestPath)) {
    return null;
  }

  try {
    return readFileSync(digestPath, 'utf-8');
  } catch (error) {
    console.error(`[specialist-context] Failed to load digest for ${projectKey}/${specialistType}:`, error);
    return null;
  }
}

/**
 * Get the number of recent runs to include in context
 *
 * Reads from project config or uses default.
 *
 * @param projectKey - Project identifier
 * @returns Number of runs to include (default: 5)
 */
function getContextRunsCount(projectKey: string): number {
  const project = getProjectSync(projectKey);
  return project?.specialists?.context_runs ?? 5;
}

/**
 * Get the model to use for digest generation
 *
 * Reads from project config or uses the same model as the specialist.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @returns Model ID to use
 */
function roleForSpecialist(specialistType: string): { role: 'plan' | 'work' | 'review' | 'test' | 'ship'; subRole?: string } {
  const normalized = specialistType.replace(/-agent$/, '');
  if (normalized === 'inspect') return { role: 'work', subRole: 'inspect' };
  if (normalized === 'review') return { role: 'review' };
  if (normalized === 'test' || normalized === 'uat') return { role: 'test' };
  if (normalized === 'merge' || normalized === 'ship') return { role: 'ship' };
  if (normalized === 'planning' || normalized === 'plan') return { role: 'plan' };
  return { role: 'work' };
}

function getDigestModel(projectKey: string, specialistType: string): string {
  const project = getProjectSync(projectKey);

  // Check for explicit digest model in project config
  if (project?.specialists?.digest_model) {
    return project.specialists.digest_model;
  }

  try {
    const { role, subRole } = roleForSpecialist(specialistType);
    return resolveModel(role, subRole, loadYamlConfig().config);
  } catch (error) {
    // Default to Sonnet if can't resolve
    return 'claude-sonnet-4-6';
  }
}async function generateContextDigestPromise(
  projectKey: string,
  specialistType: string,
  options: {
    runCount?: number;
    model?: string;
    force?: boolean; // Generate even if no recent runs
  } = {}
): Promise<string | null> {
  ensureContextDirectory(projectKey, specialistType);

  // Get recent runs
  const runCount = options.runCount ?? getContextRunsCount(projectKey);
  const { getRecentRunLogs } = await import('./specialist-logs.js');
  const recentRuns = getRecentRunLogs(projectKey, specialistType, runCount);

  if (recentRuns.length === 0 && !options.force) {
    console.log(`[specialist-context] No recent runs for ${projectKey}/${specialistType}, skipping digest generation`);
    return null;
  }

  // Build prompt for digest generation
  const prompt = buildDigestPrompt(projectKey, specialistType, recentRuns);
  const model = options.model ?? getDigestModel(projectKey, specialistType);

  try {
    console.log(`[claude-invoke] purpose=specialist-digest | model=${model} | source=specialist-context.ts:generateContextDigest | project=${projectKey} | specialist=${specialistType} | promptChars=${prompt.length}`);

    // Use Claude Code CLI to generate digest
    // Write prompt to temp file to avoid shell escaping issues
    const tempDir = join(getPanopticonHome(), 'tmp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const promptFile = join(tempDir, `digest-prompt-${Date.now()}.md`);
    writeFileSync(promptFile, prompt, 'utf-8');

    // Run Claude Code with the prompt (include provider env vars for non-Anthropic models)
    const { getProviderEnvForModel } = await import('../agents.js');
    const providerEnv = await getProviderEnvForModel(model);
    const envPrefix = Object.entries(providerEnv).map(([k, v]) => `${k}="${v}"`).join(' ');
    const permissionFlags = getClaudePermissionFlagsStringSync();
    const { stdout, stderr } = await execAsync(
      `${envPrefix ? envPrefix + ' ' : ''}claude ${permissionFlags} --model ${model} "$(cat '${promptFile}')"`,
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 60000, // 60 second timeout
      }
    );

    // Clean up temp file
    try {
      unlinkSync(promptFile);
    } catch {
      // Ignore cleanup errors
    }

    if (stderr && !stderr.includes('warning')) {
      console.error(`[claude-invoke] STDERR purpose=specialist-digest | model=${model} | project=${projectKey} | specialist=${specialistType} | stderr="${stderr.slice(0, 200)}"`);
    }

    const digest = stdout.trim();

    if (!digest) {
      console.error(`[claude-invoke] FAILED purpose=specialist-digest | model=${model} | project=${projectKey} | specialist=${specialistType} | error="empty output"`);
      return null;
    }

    // Save digest
    const digestPath = getContextDigestPath(projectKey, specialistType);
    writeFileSync(digestPath, digest, 'utf-8');

    console.log(`[claude-invoke] SUCCESS purpose=specialist-digest | model=${model} | project=${projectKey} | specialist=${specialistType} | outputChars=${digest.length}`);
    return digest;
  } catch (error: any) {
    console.error(`[claude-invoke] FAILED purpose=specialist-digest | model=${model} | project=${projectKey} | specialist=${specialistType} | error="${error.message}"`);
    // Degrade gracefully - return null so specialist can continue without context
    return null;
  }
}

/**
 * Build the prompt for digest generation
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param recentRuns - Recent run logs
 * @returns Prompt for Claude
 */
function buildDigestPrompt(
  projectKey: string,
  specialistType: string,
  recentRuns: RunLogEntry[]
): string {
  const project = getProjectSync(projectKey);
  const projectName = project?.name || projectKey;

  let prompt = `You are analyzing the recent history of a ${specialistType} specialist for the ${projectName} project.

Your task is to generate a concise context digest that will be provided to the specialist at the start of their next run. This digest should help them understand:
- Common patterns and practices observed in recent runs
- Recurring issues or failure modes
- Successful approaches and best practices
- Any project-specific context that would be helpful

Generate a digest in markdown format. Keep it focused and actionable - aim for 200-400 words total.

## Recent Runs

`;

  if (recentRuns.length === 0) {
    prompt += `No recent runs available yet. This is the specialist's first run.\n\n`;
    prompt += `Generate a brief introduction for the specialist explaining their role and what to expect.\n`;
  } else {
    recentRuns.forEach((run, index) => {
      prompt += `### Run ${index + 1}: ${run.metadata.issueId} (${run.metadata.status || 'unknown'})\n`;
      prompt += `Started: ${run.metadata.startedAt}\n`;
      if (run.metadata.finishedAt) {
        prompt += `Finished: ${run.metadata.finishedAt}\n`;
      }
      if (run.metadata.duration) {
        const durationSec = Math.floor(run.metadata.duration / 1000);
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        prompt += `Duration: ${minutes}m ${seconds}s\n`;
      }
      if (run.metadata.notes) {
        prompt += `Notes: ${run.metadata.notes}\n`;
      }

      // Include snippets from the log if available
      try {
        const logContent = readFileSync(run.filePath, 'utf-8');
        // Extract key sections (limit to avoid overwhelming the prompt)
        const maxChars = 500;
        const transcriptMatch = logContent.match(/## Session Transcript\n([\s\S]+?)(?=\n## |$)/);
        if (transcriptMatch) {
          let transcript = transcriptMatch[1].trim();
          if (transcript.length > maxChars) {
            transcript = transcript.substring(0, maxChars) + '... [truncated]';
          }
          prompt += `\nTranscript excerpt:\n${transcript}\n`;
        }
      } catch (error) {
        // If we can't read the log, skip the excerpt
      }

      prompt += `\n`;
    });
  }

  prompt += `\n## Your Task

Generate a context digest that summarizes the key insights from these runs. Format it as:

# Recent ${specialistType} History for ${projectName}

## Summary
[2-3 sentence overview of patterns and trends]

## Common Patterns
[Bulleted list of observed patterns]

## Recent Notable Runs
[Brief highlights of 2-3 most interesting runs]

## Recommendations
[Specific guidance for the next run based on this history]

Keep it concise, actionable, and focused on helping the specialist be more effective.`;

  return prompt;
}async function regenerateContextDigestPromise(
  projectKey: string,
  specialistType: string
): Promise<string | null> {
  return (await Effect.runPromise(generateContextDigest(projectKey, specialistType, { force: true })));
}

/**
 * Generate digest after a run completes (async, fire-and-forget)
 *
 * This is called after a specialist finishes a run to update the context
 * for the next run. It runs asynchronously and failures are logged but not thrown.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
export function scheduleDigestGeneration(projectKey: string, specialistType: string): void {
  // Run async without awaiting
  Effect.runPromise(generateContextDigest(projectKey, specialistType)).catch((error) => {
    console.error(
      `[specialist-context] Background digest generation failed for ${projectKey}/${specialistType}:`,
      error
    );
  });
}

/**
 * Check if a context digest exists
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @returns True if digest file exists
 */
export function hasContextDigest(projectKey: string, specialistType: string): boolean {
  const digestPath = getContextDigestPath(projectKey, specialistType);
  return existsSync(digestPath);
}

/**
 * Delete the context digest
 *
 * Useful for forcing a fresh start or clearing stale context.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @returns True if digest was deleted, false if it didn't exist
 */
export function deleteContextDigest(projectKey: string, specialistType: string): boolean {
  const digestPath = getContextDigestPath(projectKey, specialistType);

  if (!existsSync(digestPath)) {
    return false;
  }

  try {
    unlinkSync(digestPath);
    return true;
  } catch (error) {
    console.error(`[specialist-context] Failed to delete digest:`, error);
    return false;
  }
}

// ─── Effect variants (PAN-1249) ──────────────────────────────────────────────

/**
 * Effect variant of {@link generateContextDigest}. The Promise version already
 * resolves to `null` on every failure mode (claude unavailable, empty runs,
 * write error), so the Effect form mirrors that contract via `Effect.promise`.
 */
export const generateContextDigest = (
  projectKey: string,
  specialistType: string,
  options: { runCount?: number; model?: string; force?: boolean } = {},
): Effect.Effect<string | null> =>
  Effect.promise(() => generateContextDigestPromise(projectKey, specialistType, options));

/**
 * Effect variant of {@link regenerateContextDigest}. Same swallowed-failure
 * semantics as the Promise version.
 */
export const regenerateContextDigest = (
  projectKey: string,
  specialistType: string,
): Effect.Effect<string | null> =>
  Effect.promise(() => regenerateContextDigestPromise(projectKey, specialistType));

/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { PANOPTICON_HOME } from '../paths.js';
import {
  getSessionId,
  setSessionId,
  recordWake,
  getTmuxSessionName,
  wakeSpecialist,
  isRunning,
} from './specialists.js';
import { runMergeValidation, autoRevertMerge } from './validation.js';

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const MERGE_HISTORY_DIR = join(SPECIALISTS_DIR, 'merge-agent');
const MERGE_HISTORY_FILE = join(MERGE_HISTORY_DIR, 'history.jsonl');

/**
 * Context for a merge conflict resolution request
 */
export interface MergeConflictContext {
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  issueId: string;
  testCommand?: string;
}

/**
 * Result of merge agent execution
 */
export interface MergeResult {
  success: boolean;
  resolvedFiles?: string[];
  failedFiles?: string[];
  testsStatus?: 'PASS' | 'FAIL' | 'SKIP';
  validationStatus?: 'PASS' | 'FAIL' | 'NOT_RUN';
  reason?: string;
  notes?: string;
  output?: string;
}

/**
 * Merge history entry
 */
interface MergeHistoryEntry {
  timestamp: string;
  issueId: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  result: MergeResult;
  sessionId?: string;
}

/**
 * Timeout for merge agent in milliseconds (15 minutes)
 */
const MERGE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Build the prompt for merge-agent
 */
function buildMergePrompt(context: MergeConflictContext): string {
  const templatePath = join(__dirname, 'prompts', 'merge-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Merge agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Replace template variables
  const prompt = template
    .replace(/\{\{projectPath\}\}/g, context.projectPath)
    .replace(/\{\{sourceBranch\}\}/g, context.sourceBranch)
    .replace(/\{\{targetBranch\}\}/g, context.targetBranch)
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(
      /\{\{conflictFiles\}\}/g,
      context.conflictFiles.map((f) => `  - ${f}`).join('\n')
    )
    .replace(/\{\{testCommand\}\}/g, context.testCommand || 'skip');

  return prompt;
}

/**
 * Detect test command from project structure
 */
function detectTestCommand(projectPath: string): string {
  // Check for package.json (Node.js)
  const packageJsonPath = join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for pom.xml (Java/Maven)
  if (existsSync(join(projectPath, 'pom.xml'))) {
    return 'mvn test';
  }

  // Check for Cargo.toml (Rust)
  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    return 'cargo test';
  }

  // Check for pytest (Python)
  if (existsSync(join(projectPath, 'pytest.ini')) || existsSync(join(projectPath, 'setup.py'))) {
    return 'pytest';
  }

  // No test command detected
  return 'skip';
}

/**
 * Parse result markers from agent output
 */
function parseAgentOutput(output: string): MergeResult {
  const lines = output.split('\n');

  let mergeResult: 'SUCCESS' | 'FAILURE' | null = null;
  let resolvedFiles: string[] = [];
  let failedFiles: string[] = [];
  let testsStatus: 'PASS' | 'FAIL' | 'SKIP' | null = null;
  let validationStatus: 'PASS' | 'FAIL' | null = null;
  let reason = '';
  let notes = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Match MERGE_RESULT
    if (trimmed.startsWith('MERGE_RESULT:')) {
      const value = trimmed.substring('MERGE_RESULT:'.length).trim();
      if (value === 'SUCCESS' || value === 'FAILURE') {
        mergeResult = value;
      }
    }

    // Match RESOLVED_FILES
    if (trimmed.startsWith('RESOLVED_FILES:')) {
      const value = trimmed.substring('RESOLVED_FILES:'.length).trim();
      resolvedFiles = value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Match FAILED_FILES
    if (trimmed.startsWith('FAILED_FILES:')) {
      const value = trimmed.substring('FAILED_FILES:'.length).trim();
      failedFiles = value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Match TESTS
    if (trimmed.startsWith('TESTS:')) {
      const value = trimmed.substring('TESTS:'.length).trim();
      if (value === 'PASS' || value === 'FAIL' || value === 'SKIP') {
        testsStatus = value;
      }
    }

    // Match VALIDATION
    if (trimmed.startsWith('VALIDATION:')) {
      const value = trimmed.substring('VALIDATION:'.length).trim();
      if (value === 'PASS' || value === 'FAIL') {
        validationStatus = value;
      }
    }

    // Match REASON
    if (trimmed.startsWith('REASON:')) {
      reason = trimmed.substring('REASON:'.length).trim();
    }

    // Match NOTES
    if (trimmed.startsWith('NOTES:')) {
      notes = trimmed.substring('NOTES:'.length).trim();
    }
  }

  // Build result
  if (mergeResult === 'SUCCESS') {
    return {
      success: true,
      resolvedFiles,
      testsStatus: testsStatus || 'SKIP',
      validationStatus: validationStatus || 'NOT_RUN',
      notes,
      output,
    };
  } else if (mergeResult === 'FAILURE') {
    return {
      success: false,
      failedFiles,
      validationStatus: validationStatus || 'NOT_RUN',
      reason,
      notes,
      output,
    };
  } else {
    // No result markers found - assume failure
    return {
      success: false,
      validationStatus: 'NOT_RUN',
      reason: 'Agent did not report result in expected format',
      output,
    };
  }
}

/**
 * Get conflict files from git status (async)
 */
async function getConflictFiles(projectPath: string): Promise<string[]> {
  try {
    const { stdout: status } = await execAsync('git diff --name-only --diff-filter=U', {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    return status
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error('Failed to get conflict files:', error);
    return [];
  }
}

/**
 * Log merge to history
 */
function logMergeHistory(context: MergeConflictContext, result: MergeResult, sessionId?: string): void {
  // Ensure history directory exists
  if (!existsSync(MERGE_HISTORY_DIR)) {
    mkdirSync(MERGE_HISTORY_DIR, { recursive: true });
  }

  const entry: MergeHistoryEntry = {
    timestamp: new Date().toISOString(),
    issueId: context.issueId,
    sourceBranch: context.sourceBranch,
    targetBranch: context.targetBranch,
    conflictFiles: context.conflictFiles,
    result: {
      ...result,
      output: undefined, // Don't store full output in history
    },
    sessionId,
  };

  appendFileSync(MERGE_HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Log activity to the dashboard activity log
 */
function logActivity(action: string, details: string): void {
  const ACTIVITY_LOG = '/tmp/panopticon-activity.log';
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      source: 'merge-agent',
      action,
      details,
    };
    appendFileSync(ACTIVITY_LOG, JSON.stringify(entry) + '\n');
  } catch {
    // Non-fatal
  }
}

/**
 * Capture tmux output and look for result markers (async)
 */
async function captureTmuxOutput(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`tmux capture-pane -t "${sessionName}" -p`, { encoding: 'utf-8' });
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Check if specialist-merge-agent tmux session is running (async)
 */
async function isMergeAgentRunning(): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t specialist-merge-agent 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a message to an agent's tmux session (async)
 */
async function sendMessageToAgent(issueId: string, message: string): Promise<boolean> {
  // Agent sessions are typically named agent-{issueId} (lowercase)
  const sessionName = `agent-${issueId.toLowerCase()}`;

  try {
    // Check if session exists
    await execAsync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { encoding: 'utf-8' });

    // Send the message (with delay before Enter to avoid race condition)
    const escapedMessage = message.replace(/'/g, "'\\''");
    await execAsync(`tmux send-keys -t "${sessionName}" '${escapedMessage}'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 200)); // Small delay for terminal to process text
    await execAsync(`tmux send-keys -t "${sessionName}" C-m`, { encoding: 'utf-8' });

    console.log(`[merge-agent] Sent message to ${sessionName}`);
    logActivity('agent_message', `Sent to ${sessionName}: ${message.slice(0, 100)}...`);
    return true;
  } catch {
    console.log(`[merge-agent] Could not send message to ${sessionName} (session may not exist)`);
    return false;
  }
}

/**
 * Spawn merge-agent to resolve conflicts using the tmux session
 *
 * @param context - Merge conflict context
 * @returns Promise that resolves with merge result
 */
export async function spawnMergeAgent(context: MergeConflictContext): Promise<MergeResult> {
  console.log(`[merge-agent] Starting conflict resolution for ${context.issueId}`);
  logActivity('merge_start', `Starting merge for ${context.issueId}: ${context.conflictFiles.join(', ')}`);

  // Detect test command if not provided
  if (!context.testCommand) {
    context.testCommand = detectTestCommand(context.projectPath);
  }

  const tmuxSession = getTmuxSessionName('merge-agent');
  console.log(`[merge-agent] Using tmux session: ${tmuxSession}`);
  console.log(`[merge-agent] Test command: ${context.testCommand}`);

  // Check if merge-agent session is running
  if (!(await isMergeAgentRunning())) {
    console.log(`[merge-agent] Session not running, cannot proceed`);
    logActivity('merge_error', `Session ${tmuxSession} not running`);
    return {
      success: false,
      reason: `Specialist ${tmuxSession} is not running. Start Cloister first.`,
    };
  }

  // Build prompt
  const prompt = buildMergePrompt(context);

  // Escape prompt for tmux send-keys
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  try {
    // Send prompt to tmux session
    console.log(`[merge-agent] Sending task to ${tmuxSession}...`);
    await execAsync(`tmux send-keys -t "${tmuxSession}" '${escapedPrompt}'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-m`, { encoding: 'utf-8' });

    // Record wake event
    recordWake('merge-agent');
    logActivity('merge_task_sent', `Task sent to ${tmuxSession}`);

    console.log(`[merge-agent] Task sent, waiting for completion...`);

    // Poll for result with timeout
    const startTime = Date.now();
    const POLL_INTERVAL = 5000; // 5 seconds
    let lastOutput = '';

    while (Date.now() - startTime < MERGE_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      const output = await captureTmuxOutput(tmuxSession);

      // Check if we have new output with result markers
      if (output !== lastOutput) {
        lastOutput = output;

        // Look for result markers in the output
        if (output.includes('MERGE_RESULT:')) {
          console.log(`[merge-agent] Found result markers in output`);

          const result = parseAgentOutput(output);

          // If agent reports success, run post-merge validation
          if (result.success) {
            console.log(`[merge-agent] Agent reported success, running post-merge validation...`);
            logActivity('merge_validation_start', `Running validation for ${context.issueId}`);

            const validationResult = await runMergeValidation({
              projectPath: context.projectPath,
              issueId: context.issueId,
            });

            if (validationResult.valid) {
              // Validation passed
              console.log(`[merge-agent] ✓ Validation passed`);
              logActivity('merge_success', `Merge and validation completed for ${context.issueId}`);

              // Update result with validation status
              result.validationStatus = 'PASS';
              logMergeHistory(context, result);

              return result;
            } else {
              // Validation failed - auto-revert
              console.log(`[merge-agent] ✗ Validation failed:`, validationResult.failures);
              logActivity('merge_validation_fail', `Validation failed for ${context.issueId}: ${validationResult.failures.map(f => f.type).join(', ')}`);

              // Attempt auto-revert
              const revertSuccess = await autoRevertMerge(context.projectPath);

              const failureReason = validationResult.failures.map(f => `${f.type}: ${f.message}`).join('; ');
              const revertNote = revertSuccess
                ? 'Merge auto-reverted to clean state'
                : 'WARNING: Auto-revert failed - manual cleanup required';

              console.log(`[merge-agent] ${revertNote}`);
              logActivity('merge_auto_revert', revertNote);

              // Return failure with validation details
              const failedResult: MergeResult = {
                success: false,
                validationStatus: 'FAIL',
                reason: `Validation failed: ${failureReason}. ${revertNote}`,
                notes: result.notes,
                output,
              };

              logMergeHistory(context, failedResult);
              return failedResult;
            }
          } else {
            // Agent reported failure
            logActivity('merge_failure', `Merge failed for ${context.issueId}: ${result.reason}`);
            logMergeHistory(context, result);
            return result;
          }
        }
      }

      // Log progress periodically
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 30 === 0) {
        console.log(`[merge-agent] Still working... (${elapsed}s elapsed)`);
      }
    }

    // Timeout
    console.log(`[merge-agent] Timeout after ${MERGE_TIMEOUT_MS / 1000} seconds`);
    logActivity('merge_timeout', `Merge timed out for ${context.issueId}`);

    return {
      success: false,
      reason: `Timeout after ${MERGE_TIMEOUT_MS / 60000} minutes`,
      output: lastOutput,
    };
  } catch (error: any) {
    console.error(`[merge-agent] Failed:`, error);
    logActivity('merge_error', `Error: ${error.message}`);

    const result: MergeResult = {
      success: false,
      reason: error.message || 'Unknown error',
    };

    logMergeHistory(context, result);
    return result;
  }
}

/**
 * Attempt merge and handle result (clean merge, conflicts, or failure)
 *
 * This function:
 * 1. Attempts to merge sourceBranch into current branch
 * 2. If clean merge: commits and optionally runs tests
 * 3. If conflicts: spawns merge-agent to resolve them
 * 4. If failure: returns error
 *
 * @param projectPath - Project root path
 * @param sourceBranch - Feature branch to merge
 * @param targetBranch - Target branch (usually main)
 * @param issueId - Issue identifier
 * @returns Promise that resolves with merge result
 */
export async function spawnMergeAgentForBranches(
  projectPath: string,
  sourceBranch: string,
  targetBranch: string,
  issueId: string
): Promise<MergeResult> {
  console.log(`[merge-agent] Waking specialist for merge of ${sourceBranch} into ${targetBranch}`);
  logActivity('merge_attempt', `Waking specialist for merge: ${sourceBranch} -> ${targetBranch}`);

  // Pre-flight checks (quick validation before waking specialist)
  try {
    // Check that source branch is pushed to remote
    try {
      const { stdout: remoteBranches } = await execAsync(`git ls-remote --heads origin ${sourceBranch}`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });

      if (!remoteBranches.trim()) {
        const message = `Branch ${sourceBranch} is not pushed to remote.`;
        console.error(`[merge-agent] ${message}`);
        logActivity('merge_blocked', message);
        await sendMessageToAgent(issueId, `⚠️ MERGE BLOCKED: Branch "${sourceBranch}" is not pushed. Run: git push -u origin ${sourceBranch}`);
        return { success: false, reason: message };
      }
    } catch {
      const message = `Cannot verify remote branch ${sourceBranch}.`;
      console.error(`[merge-agent] ${message}`);
      logActivity('merge_blocked', message);
      return { success: false, reason: message };
    }

    // NOTE: We don't check for uncommitted changes in the main repo here.
    // The merge happens via git merge which will fail if there are conflicts.
    // Uncommitted changes in main are the user's own work and shouldn't block
    // merging a feature branch. The dashboard server already checks the
    // workspace for uncommitted changes before initiating the merge.
  } catch (error: any) {
    return { success: false, reason: `Pre-flight check failed: ${error.message}` };
  }

  // Record current HEAD before merge
  const { stdout: headBeforeRaw } = await execAsync('git rev-parse HEAD', {
    cwd: projectPath,
    encoding: 'utf-8',
  });
  const headBefore = headBeforeRaw.trim();

  // Build the task prompt for the merge-agent specialist
  const taskPrompt = `MERGE TASK for ${issueId}:

PROJECT: ${projectPath}
SOURCE BRANCH: ${sourceBranch}
TARGET BRANCH: ${targetBranch}
CURRENT HEAD: ${headBefore}

INSTRUCTIONS:
1. cd ${projectPath}
2. git checkout ${targetBranch}
3. git pull origin ${targetBranch} --ff-only
4. git merge ${sourceBranch}
5. If conflicts: resolve them intelligently, then git add and git commit
6. If clean merge: the merge commit is auto-created
7. Run tests: npm test (or appropriate test command)
8. If tests pass: git push origin ${targetBranch}
9. If tests fail: git reset --hard HEAD~1 and report failure

CRITICAL: You MUST complete this merge. The approve operation is waiting.
When done, the merge commit should be pushed to origin/${targetBranch}.

DO NOT:
- Delete the feature branch (locally or remotely)
- Clean up workspaces
- Do anything beyond the merge, test, and push steps above

Report any issues or conflicts you encountered.`;

  // Wake the merge-agent specialist
  console.log(`[merge-agent] Waking specialist with merge task...`);
  const wakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
    waitForReady: true,
    startIfNotRunning: true,
  });

  if (!wakeResult.success) {
    console.error(`[merge-agent] Failed to wake specialist: ${wakeResult.message}`);
    logActivity('merge_error', `Failed to wake specialist: ${wakeResult.message}`);
    return {
      success: false,
      reason: `Failed to wake merge-agent specialist: ${wakeResult.message}`,
    };
  }

  console.log(`[merge-agent] Specialist woken, waiting for merge completion...`);
  logActivity('merge_specialist_woken', `Specialist woken, task sent`);

  // Poll for merge completion (check if HEAD has changed and been pushed)
  const POLL_INTERVAL = 5000; // 5 seconds
  const MAX_WAIT = 300000; // 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    try {
      // Check if we're still on target branch
      const { stdout: currentBranchRaw } = await execAsync('git branch --show-current', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      const currentBranch = currentBranchRaw.trim();

      if (currentBranch !== targetBranch) {
        // Specialist might still be working, continue polling
        continue;
      }

      // Check if HEAD has changed (merge happened)
      const { stdout: currentHeadRaw } = await execAsync('git rev-parse HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      const currentHead = currentHeadRaw.trim();

      if (currentHead !== headBefore) {
        // HEAD changed - check if it's a merge commit
        const { stdout: commitMessageRaw } = await execAsync('git log -1 --pretty=%s', {
          cwd: projectPath,
          encoding: 'utf-8',
        });
        const commitMessage = commitMessageRaw.trim().toLowerCase();

        if (commitMessage.includes('merge') || commitMessage.includes(sourceBranch.toLowerCase())) {
          // Verify it's pushed
          try {
            const { stdout: remoteHeadRaw } = await execAsync(`git rev-parse origin/${targetBranch}`, {
              cwd: projectPath,
              encoding: 'utf-8',
            });
            const remoteHead = remoteHeadRaw.trim();

            if (remoteHead === currentHead) {
              console.log(`[merge-agent] Merge completed and pushed, running validation...`);
              logActivity('merge_validation_start', `Running post-merge validation for ${issueId}`);

              // Run validation
              const validationResult = await runMergeValidation({
                projectPath,
                issueId,
              });

              if (validationResult.valid) {
                // Validation passed
                console.log(`[merge-agent] ✓ Merge validation passed`);
                logActivity('merge_complete', `Merge and validation completed by specialist`);
                return {
                  success: true,
                  validationStatus: 'PASS',
                  testsStatus: 'SKIP', // Specialist ran tests, we trust the result
                  notes: 'Merge completed by merge-agent specialist and validation passed',
                };
              } else {
                // Validation failed - auto-revert
                console.log(`[merge-agent] ✗ Validation failed:`, validationResult.failures);
                logActivity('merge_validation_fail', `Validation failed: ${validationResult.failures.map(f => f.type).join(', ')}`);

                // Attempt auto-revert
                const revertSuccess = await autoRevertMerge(projectPath);

                // Force push to revert the remote as well
                if (revertSuccess) {
                  try {
                    await execAsync(`git push --force-with-lease origin ${targetBranch}`, {
                      cwd: projectPath,
                      encoding: 'utf-8',
                    });
                    console.log(`[merge-agent] ✓ Auto-revert pushed to remote`);
                    logActivity('merge_auto_revert', 'Merge auto-reverted and pushed to remote');
                  } catch (pushError: any) {
                    console.error(`[merge-agent] ✗ Failed to push revert: ${pushError.message}`);
                    logActivity('merge_revert_push_fail', 'Auto-revert successful but push failed');
                  }
                }

                const failureReason = validationResult.failures.map(f => `${f.type}: ${f.message}`).join('; ');
                const revertNote = revertSuccess
                  ? 'Merge auto-reverted and force-pushed to remote'
                  : 'WARNING: Auto-revert failed - manual cleanup required';

                return {
                  success: false,
                  validationStatus: 'FAIL',
                  reason: `Validation failed: ${failureReason}. ${revertNote}`,
                  notes: 'Merge completed but validation failed, auto-reverted',
                };
              }
            }
          } catch {
            // Remote check failed, but local merge is done
            console.log(`[merge-agent] Merge completed locally, push status unknown`);
          }

          // Local merge done but not pushed yet - keep polling
          console.log(`[merge-agent] Merge commit detected, waiting for push...`);
        }
      }

      // Check if merge-agent is still running
      if (!isRunning('merge-agent')) {
        console.error(`[merge-agent] Specialist stopped unexpectedly`);
        logActivity('merge_error', 'Specialist stopped unexpectedly');
        return {
          success: false,
          reason: 'merge-agent specialist stopped before completing the merge',
        };
      }

    } catch (pollError: any) {
      console.warn(`[merge-agent] Poll error: ${pollError.message}`);
      // Continue polling
    }
  }

  // Timeout
  console.error(`[merge-agent] Timeout waiting for merge completion`);
  logActivity('merge_timeout', 'Timeout waiting for specialist to complete merge');
  return {
    success: false,
    reason: 'Timeout waiting for merge-agent specialist to complete merge (5 minutes)',
  };
}

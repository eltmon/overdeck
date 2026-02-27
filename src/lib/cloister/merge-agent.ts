/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { sendKeysAsync, sessionExists } from '../tmux.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { PANOPTICON_HOME } from '../paths.js';
import {
  getSessionId,
  recordWake,
  getTmuxSessionName,
  wakeSpecialist,
  isRunning,
} from './specialists.js';
import { runMergeValidation, autoRevertMerge } from './validation.js';
import { cleanupStaleLocks } from '../git-utils.js';

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
    .replace(/\{\{testCommand\}\}/g, context.testCommand || 'skip')
    .replace(/\{\{apiUrl\}\}/g, process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`);

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
 * Conditionally compact beads if there are old closed issues
 * Runs as a background task to avoid blocking merge completion
 */
async function conditionalBeadsCompaction(projectPath: string): Promise<void> {
  console.log(`[merge-agent] Checking if beads compaction is needed...`);

  try {
    // Check if bd is available
    try {
      await execAsync('which bd', { encoding: 'utf-8' });
    } catch {
      console.log(`[merge-agent] bd not available, skipping compaction`);
      return;
    }

    // Check if .beads exists
    const beadsDir = join(projectPath, '.beads');
    if (!existsSync(beadsDir)) {
      console.log(`[merge-agent] No .beads directory, skipping compaction`);
      return;
    }

    // Check for closed issues older than 30 days
    const { stdout: oldClosedCount } = await execAsync(
      `bd list --status closed --json 2>/dev/null | jq '[.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > (30 * 24 * 60 * 60))] | length' 2>/dev/null || echo "0"`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    const count = parseInt(oldClosedCount.trim(), 10) || 0;
    if (count === 0) {
      console.log(`[merge-agent] No old closed beads to compact`);
      return;
    }

    console.log(`[merge-agent] Found ${count} closed beads older than 30 days, running compaction...`);
    logActivity('beads_compaction_start', `Compacting ${count} old closed beads`);

    // Run compaction
    await execAsync(`bd admin compact --days 30`, { cwd: projectPath, encoding: 'utf-8' });

    // Commit the compacted beads
    await execAsync(`git add .beads/`, { cwd: projectPath, encoding: 'utf-8' });

    // Check if there are changes to commit
    try {
      await execAsync(`git diff --cached --quiet`, { cwd: projectPath, encoding: 'utf-8' });
      // No changes
      console.log(`[merge-agent] Compaction complete, no changes to commit`);
    } catch {
      // There are changes, commit them
      await execAsync(
        `git commit -m "chore: compact beads (remove closed issues > 30 days)"`,
        { cwd: projectPath, encoding: 'utf-8' }
      );
      await execAsync(`git push`, { cwd: projectPath, encoding: 'utf-8' });
      console.log(`[merge-agent] ✓ Beads compacted and committed`);
      logActivity('beads_compaction_complete', `Compacted and committed beads cleanup`);
    }
  } catch (err: any) {
    // Non-fatal - log and continue
    console.warn(`[merge-agent] Beads compaction failed: ${err.message}`);
    logActivity('beads_compaction_error', `Compaction failed: ${err.message}`);
  }
}

/**
 * Notify TLDR daemon to reindex changed files after merge
 */
async function notifyTldrDaemon(projectPath: string, sourceBranch: string): Promise<void> {
  try {
    console.log(`[merge-agent] Notifying TLDR daemon to reindex changed files...`);

    // Check if TLDR daemon is available
    const venvPath = join(projectPath, '.venv');
    if (!existsSync(venvPath)) {
      console.log(`[merge-agent] No .venv found, skipping TLDR notification`);
      return;
    }

    // Get changed files from the merge
    const { stdout } = await execAsync(`git diff --name-only HEAD~1 HEAD`, {
      cwd: projectPath,
      encoding: 'utf-8'
    });

    const changedFiles = stdout
      .trim()
      .split('\n')
      .filter(f => f.trim().length > 0)
      .filter(f => {
        // Only include source code files (skip docs, configs, etc)
        const ext = f.split('.').pop()?.toLowerCase();
        return ext && ['ts', 'js', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'h'].includes(ext);
      });

    if (changedFiles.length === 0) {
      console.log(`[merge-agent] No source files changed, skipping TLDR notification`);
      return;
    }

    console.log(`[merge-agent] Found ${changedFiles.length} changed source files to reindex`);

    // Get TLDR daemon service
    const { getTldrDaemonService } = await import('../tldr-daemon.js');
    const tldrService = getTldrDaemonService(projectPath, venvPath);

    // Check if daemon is running
    const status = await tldrService.getStatus();
    if (!status.running) {
      console.log(`[merge-agent] TLDR daemon not running, skipping notification`);
      return;
    }

    // Trigger warm to reindex (this will update the index incrementally)
    console.log(`[merge-agent] Triggering TLDR index warm...`);
    await tldrService.warm(true);  // background mode

    console.log(`[merge-agent] ✓ TLDR daemon notified to reindex`);
    logActivity('tldr_notified', `Notified TLDR daemon to reindex ${changedFiles.length} files`);
  } catch (error: any) {
    // Non-fatal - log warning and continue
    console.warn(`[merge-agent] Failed to notify TLDR daemon: ${error.message}`);
    logActivity('tldr_notify_error', `TLDR notification failed: ${error.message}`);
  }
}

/**
 * Post-merge cleanup: move PRD to completed, update issue status
 */
async function postMergeCleanup(issueId: string, projectPath: string): Promise<void> {
  console.log(`[merge-agent] Running post-merge cleanup for ${issueId}`);

  // 1. Move PRD from active to completed
  try {
    const activePrdPath = join(projectPath, 'docs', 'prds', 'active', `${issueId.toLowerCase()}-plan.md`);
    const completedPrdPath = join(projectPath, 'docs', 'prds', 'completed', `${issueId.toLowerCase()}-plan.md`);

    if (existsSync(activePrdPath)) {
      // Ensure completed directory exists
      const completedDir = dirname(completedPrdPath);
      if (!existsSync(completedDir)) {
        mkdirSync(completedDir, { recursive: true });
      }

      // Move the file using git mv for proper tracking
      await execAsync(`git mv "${activePrdPath}" "${completedPrdPath}"`, { cwd: projectPath, encoding: 'utf-8' });
      await execAsync(`git commit -m "Move ${issueId} PRD to completed"`, { cwd: projectPath, encoding: 'utf-8' });
      await execAsync(`git push`, { cwd: projectPath, encoding: 'utf-8' });
      console.log(`[merge-agent] ✓ Moved PRD to completed and pushed: ${completedPrdPath}`);
      logActivity('prd_moved', `Moved ${issueId} PRD to completed directory`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not move PRD: ${err}`);
    // Non-fatal, continue with cleanup
  }

  // 2. Close the PR on GitHub (the merge was already done locally via git)
  const isGitHub = issueId.toUpperCase().startsWith('PAN-');

  if (isGitHub) {
    const issueNum = issueId.replace(/^PAN-/i, '');

    // Close the open PR for this branch (if one exists)
    try {
      const branchName = `feature/${issueId.toLowerCase()}`;
      const { stdout: prListRaw } = await execAsync(
        `gh pr list --repo eltmon/panopticon-cli --head "${branchName}" --state open --json number --jq '.[0].number'`,
        { cwd: projectPath, encoding: 'utf-8' }
      );
      const prNumber = prListRaw.trim();
      if (prNumber) {
        // Close the PR with a comment (the merge was already pushed via git)
        await execAsync(
          `gh pr close ${prNumber} --repo eltmon/panopticon-cli --comment "Merged to main via Panopticon merge-agent"`,
          { cwd: projectPath, encoding: 'utf-8' }
        );
        console.log(`[merge-agent] ✓ Closed PR #${prNumber} for ${issueId}`);
        logActivity('pr_closed', `Closed PR #${prNumber} for ${issueId}`);
      }
    } catch (err) {
      console.warn(`[merge-agent] Could not close PR: ${err}`);
    }

    // Close the issue (labels cleaned up by done.ts workflow)
    try {
      await execAsync(`gh issue close ${issueNum} --repo eltmon/panopticon-cli --comment "Merged to main" 2>/dev/null || true`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      console.log(`[merge-agent] ✓ Updated and closed GitHub issue #${issueNum}`);
      logActivity('issue_closed', `Closed GitHub issue #${issueNum} after merge`);
    } catch (err) {
      console.warn(`[merge-agent] Could not close GitHub issue: ${err}`);
    }
  } else {
    // Linear: use pan CLI to mark as done (if available)
    try {
      await execAsync(`pan work done ${issueId} -c "Merged to main" 2>/dev/null || true`, {
        encoding: 'utf-8',
      });
      console.log(`[merge-agent] ✓ Updated Linear issue ${issueId} to Done`);
      logActivity('issue_updated', `Updated ${issueId} to Done in Linear`);
    } catch (err) {
      console.warn(`[merge-agent] Could not update Linear issue: ${err}`);
    }
  }

  // 3. Update review status to 'merged' via the dashboard API
  // This ensures the dashboard shows the correct status regardless of how the merge was triggered
  try {
    const apiPort = process.env.API_PORT || process.env.PORT || '3011';
    const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
    await fetch(`${apiUrl}/api/specialists/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specialist: 'merge', issueId, status: 'passed', notes: 'Merge and validation completed' }),
    });
    console.log(`[merge-agent] ✓ Reported merge success to dashboard API`);
  } catch (err) {
    console.warn(`[merge-agent] Could not report to dashboard API: ${err}`);
  }

  // 4. Conditionally compact old beads (non-blocking cleanup)
  await conditionalBeadsCompaction(projectPath);

  console.log(`[merge-agent] Post-merge cleanup completed for ${issueId}`);
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
    // No structured result markers found - try to detect human-readable format
    // Agents sometimes output "MERGE TASK COMPLETE" instead of "MERGE_RESULT: SUCCESS"
    const lowerOutput = output.toLowerCase();

    // Check for success indicators
    const successIndicators = [
      'merge task complete',
      'successfully merged',
      'merge complete',
      'pushed merge commit',
      'successfully merged and pushed',
    ];

    const failureIndicators = [
      'merge failed',
      'merge task failed',
      'could not merge',
      'conflict not resolved',
    ];

    const hasSuccessIndicator = successIndicators.some(i => lowerOutput.includes(i));
    const hasFailureIndicator = failureIndicators.some(i => lowerOutput.includes(i));

    if (hasSuccessIndicator && !hasFailureIndicator) {
      // Extract test status from output if mentioned
      let detectedTestStatus: 'PASS' | 'FAIL' | 'SKIP' = 'SKIP';
      if (lowerOutput.includes('tests: pass') || lowerOutput.includes('tests passed') ||
          output.match(/\d+ passed/)) {
        detectedTestStatus = 'PASS';
      } else if (lowerOutput.includes('tests: fail') || lowerOutput.includes('tests failed')) {
        detectedTestStatus = 'FAIL';
      }

      console.log('[merge-agent] Detected success from human-readable output');
      return {
        success: true,
        testsStatus: detectedTestStatus,
        validationStatus: 'PASS',
        notes: 'Detected from human-readable output (agent did not use structured format)',
        output,
      };
    }

    if (hasFailureIndicator) {
      console.log('[merge-agent] Detected failure from human-readable output');
      return {
        success: false,
        validationStatus: 'NOT_RUN',
        reason: 'Detected merge failure from agent output',
        output,
      };
    }

    // Truly unrecognized output
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
    if (!sessionExists(sessionName)) {
      console.log(`[merge-agent] Could not send message to ${sessionName} (session does not exist)`);
      return false;
    }

    // Send the message using centralized sendKeys
    await sendKeysAsync(sessionName, message);

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

  try {
    // Send prompt to tmux session using centralized sendKeys
    console.log(`[merge-agent] Sending task to ${tmuxSession}...`);
    await sendKeysAsync(tmuxSession, prompt);

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
        const lowerOutput = output.toLowerCase();

        // Look for result markers in the output (structured or human-readable)
        const hasStructuredResult = output.includes('MERGE_RESULT:');
        const hasHumanReadableResult =
          lowerOutput.includes('merge task complete') ||
          lowerOutput.includes('successfully merged') ||
          lowerOutput.includes('merge complete') ||
          lowerOutput.includes('merge failed') ||
          lowerOutput.includes('merge task failed');

        if (hasStructuredResult || hasHumanReadableResult) {
          console.log(`[merge-agent] Found result markers in output (structured: ${hasStructuredResult}, human-readable: ${hasHumanReadableResult})`);

          const result = parseAgentOutput(output);

          // If agent reports success, run post-merge validation
          if (result.success) {
            console.log(`[merge-agent] Agent reported success, running post-merge validation...`);
            logActivity('merge_validation_start', `Running validation for ${context.issueId}`);

            // Extract baseline failure count from agent output for baseline comparison
            // Agent output contains a table like: │ Failed │ 18 │ 18 │ 0 ✅ │
            const baselineMatch = output.match(/Failed\s*│\s*(\d+)\s*│/);
            const baselineTestFailures = baselineMatch ? parseInt(baselineMatch[1], 10) : undefined;
            if (baselineTestFailures !== undefined) {
              console.log(`[merge-agent] Extracted baseline failure count from agent: ${baselineTestFailures}`);
            }

            const validationResult = await runMergeValidation({
              projectPath: context.projectPath,
              issueId: context.issueId,
              baselineTestFailures,
            });

            if (validationResult.valid) {
              // Validation passed
              console.log(`[merge-agent] ✓ Validation passed`);
              logActivity('merge_success', `Merge and validation completed for ${context.issueId}`);

              // Update result with validation status
              result.validationStatus = 'PASS';
              logMergeHistory(context, result);

              // Run post-merge cleanup (move PRD, update issue status)
              await postMergeCleanup(context.issueId, context.projectPath);

              // Notify TLDR daemon to reindex changed files
              await notifyTldrDaemon(context.projectPath, context.sourceBranch);

              return result;
            } else {
              // Validation failed - auto-revert
              console.log(`[merge-agent] ✗ Validation failed:`, validationResult.failures);
              logActivity('merge_validation_fail', `Validation failed for ${context.issueId}: ${validationResult.failures.map(f => f.type).join(', ')}`);

              // Revert to ORIG_HEAD (set by git at merge time)
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
    // 1. Check for and clean up stale git lock files
    console.log(`[merge-agent] Checking for stale git lock files...`);
    const lockCleanup = await cleanupStaleLocks(projectPath);

    if (lockCleanup.found.length > 0) {
      console.log(`[merge-agent] Found ${lockCleanup.found.length} lock file(s)`);

      if (lockCleanup.removed.length > 0) {
        console.log(`[merge-agent] ✓ Cleaned up ${lockCleanup.removed.length} stale lock file(s):`);
        lockCleanup.removed.forEach(f => console.log(`  - ${f}`));
        logActivity('git_lock_cleanup', `Removed ${lockCleanup.removed.length} stale lock file(s)`);
      }

      if (lockCleanup.errors.length > 0) {
        console.warn(`[merge-agent] ⚠️ Failed to clean up some locks:`, lockCleanup.errors);
        if (lockCleanup.errors.some(e => e.error.includes('Git processes are running'))) {
          const message = 'Git processes are still running - cannot safely start merge';
          console.error(`[merge-agent] ${message}`);
          logActivity('merge_blocked', message);
          return { success: false, reason: message };
        }
      }
    }

    // 2. Check that source branch is pushed to remote
    try {
      const { stdout: remoteBranches } = await execAsync(`git ls-remote --heads origin ${sourceBranch}`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });

      if (!remoteBranches.trim()) {
        const message = `Branch ${sourceBranch} is not pushed to remote.`;
        console.error(`[merge-agent] ${message}`);
        logActivity('merge_blocked', message);
        // Write feedback file and send short reference
        const { writeFeedbackFile } = await import('./feedback-writer.js');
        const blockMsg = `# Merge Blocked\n\nBranch "${sourceBranch}" is not pushed to remote.\n\n## Required Action\n\nRun: \`git push -u origin ${sourceBranch}\``;
        const fileResult = await writeFeedbackFile({
          issueId,
          specialist: 'merge-agent',
          outcome: 'blocked',
          summary: `Branch ${sourceBranch} not pushed`,
          markdownBody: blockMsg,
        });
        if (fileResult.success) {
          await sendMessageToAgent(issueId, `SPECIALIST FEEDBACK: merge-agent reported BLOCKED for ${issueId}.\nRead and address: ${fileResult.relativePath}`);
        } else {
          console.error(`[merge-agent] Failed to write feedback file for ${issueId}: ${fileResult.error}`);
        }
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

  // Record current HEAD to detect when merge happens (polling compares against this)
  const { stdout: headBeforeRaw } = await execAsync('git rev-parse HEAD', {
    cwd: projectPath,
    encoding: 'utf-8',
  });
  const headBefore = headBeforeRaw.trim();

  // Stash any uncommitted changes so the merge starts from a clean state
  // We restore the stash after completion (success or rollback)
  let stashCreated = false;
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (statusOut.trim()) {
      await execAsync('git stash push -u -m "Pre-merge stash for ' + issueId + '"', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      stashCreated = true;
      console.log(`[merge-agent] Stashed uncommitted changes before merge`);
    }
  } catch (stashErr: any) {
    console.warn(`[merge-agent] Failed to stash: ${stashErr.message} (continuing anyway)`);
  }

  // Build the task prompt for the merge-agent specialist
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  const taskPrompt = `MERGE TASK for ${issueId}:

PROJECT: ${projectPath}
SOURCE BRANCH: ${sourceBranch}
TARGET BRANCH: ${targetBranch}

INSTRUCTIONS:

PHASE 1 — BASELINE (before merge):
1. cd ${projectPath}
2. git checkout ${targetBranch}
3. git pull origin ${targetBranch} --ff-only
4. Run tests on the CURRENT ${targetBranch} to establish a baseline:
   - Use the Task tool with subagent_type="Bash" to run: npm test 2>&1 || true
   - Record the number of passing and failing tests as BASELINE_PASS and BASELINE_FAIL
   - This baseline is critical — you will compare post-merge results against it

PHASE 2 — MERGE:
5. git merge ${sourceBranch}
6. If conflicts: resolve them intelligently, then git add and git commit
7. If clean merge: the merge commit is auto-created (or fast-forward)

PHASE 3 — VERIFY:
8. Build the project to verify no compile errors:
   - Use the Task tool with subagent_type="Bash" to run the build command
   - For Node.js: npm run build
   - Check package.json to determine the right command
9. Run tests using the Task tool with subagent_type="Bash":
   - For Node.js: npm test
   - Record the number of passing and failing tests as MERGE_PASS and MERGE_FAIL

PHASE 4 — DECIDE:
10. Compare results:
    - If build failed: ROLLBACK (go to step 11)
    - If MERGE_FAIL > BASELINE_FAIL (NEW test failures introduced): ROLLBACK (go to step 11)
    - If MERGE_FAIL <= BASELINE_FAIL (no new failures): PUSH (go to step 12)
    - Pre-existing failures on ${targetBranch} are NOT a reason to rollback
11. ROLLBACK: git reset --hard ORIG_HEAD
    (ORIG_HEAD is set by git at merge time — always points to pre-merge state)
    Then report failure by calling the Panopticon API:
    curl -s -X POST ${apiUrl}/api/specialists/done \\
      -H "Content-Type: application/json" \\
      -d '{"specialist":"merge","issueId":"${issueId}","status":"failed","notes":"<reason for rollback>"}'
    Then STOP.
12. PUSH: git push origin ${targetBranch}
    Then report success by calling the Panopticon API:
    curl -s -X POST ${apiUrl}/api/specialists/done \\
      -H "Content-Type: application/json" \\
      -d '{"specialist":"merge","issueId":"${issueId}","status":"passed"}'

CRITICAL: You MUST complete this merge. The approve operation is waiting.
CRITICAL: You MUST call the /api/specialists/done endpoint whether you succeed or fail.

WHY USE SUBAGENTS FOR BUILD/TEST:
- Subagents have isolated context and won't pollute your working memory
- Build and test output can be verbose - subagents handle this cleanly
- If tests fail, the subagent returns a clear summary

DO NOT:
- Delete the feature branch (locally or remotely)
- Clean up workspaces
- Skip the build step - compile errors after merge are common
- Skip the baseline test run — without it you cannot distinguish new failures from pre-existing ones
- Use HEAD~1 for rollback — use ORIG_HEAD which git sets automatically at merge time
- Run git stash — the TypeScript layer handles stash/restore automatically
- Do anything beyond the merge, build, test, and push steps above

Report any issues or conflicts you encountered.`;

  // Wake the merge-agent specialist
  console.log(`[merge-agent] Waking specialist with merge task...`);
  const wakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
    waitForReady: true,
    startIfNotRunning: true,
    issueId: issueId,
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
        // HEAD changed — the merge happened (could be merge commit OR fast-forward)
        // For merge commits: message contains "merge" or branch name
        // For fast-forward: message is the original commit message (no "merge" keyword)
        // In BOTH cases, HEAD changing means the merge is done — verify it's pushed
        {
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

              // Extract baseline from specialist output if available
              let specialistBaseline: number | undefined;
              try {
                const specialistOutput = await captureTmuxOutput(getTmuxSessionName('merge-agent'));
                const baselineMatch = specialistOutput.match(/Failed\s*│\s*(\d+)\s*│/);
                specialistBaseline = baselineMatch ? parseInt(baselineMatch[1], 10) : undefined;
                if (specialistBaseline !== undefined) {
                  console.log(`[merge-agent] Extracted baseline from specialist: ${specialistBaseline}`);
                }
              } catch { /* ignore */ }

              // Run validation
              const validationResult = await runMergeValidation({
                projectPath,
                issueId,
                baselineTestFailures: specialistBaseline,
              });

              if (validationResult.valid) {
                // Validation passed
                console.log(`[merge-agent] ✓ Merge validation passed`);
                logActivity('merge_complete', `Merge and validation completed by specialist`);

                // Run post-merge cleanup (move PRD, update issue status)
                await postMergeCleanup(issueId, projectPath);

                // Restore stashed changes
                if (stashCreated) {
                  try {
                    await execAsync('git stash pop', { cwd: projectPath, encoding: 'utf-8' });
                    console.log(`[merge-agent] ✓ Restored stashed changes after successful merge`);
                  } catch (popErr: any) {
                    console.warn(`[merge-agent] ⚠ Failed to restore stash after merge: ${popErr.message}`);
                  }
                }

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

                // Revert to ORIG_HEAD (set by git at merge time)
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

                // Restore stashed changes after revert
                if (stashCreated) {
                  try {
                    await execAsync('git stash pop', { cwd: projectPath, encoding: 'utf-8' });
                    console.log(`[merge-agent] ✓ Restored stashed changes after revert`);
                  } catch (popErr: any) {
                    console.warn(`[merge-agent] ⚠ Failed to restore stash after revert: ${popErr.message}`);
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

/**
 * Result of syncing main into a workspace branch
 */
export interface SyncMainResult {
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  reason?: string;
}

/**
 * Scan workspace for leftover git conflict markers (async)
 */
export async function scanForConflictMarkers(projectPath: string): Promise<string[]> {
  try {
    // git diff --check exits non-zero and prints filenames when conflict markers exist
    const { stdout } = await execAsync('git diff --check 2>&1 || true', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    const files = stdout
      .split('\n')
      .filter(line => line.includes('leftover conflict marker'))
      .map(line => line.split(':')[0].trim())
      .filter(f => f.length > 0);
    return [...new Set(files)];
  } catch {
    return [];
  }
}

/**
 * Sync the latest main branch into a workspace's feature branch.
 *
 * This performs a `git merge origin/main` in the workspace. If the merge is clean
 * it returns immediately. If conflicts arise, the merge-agent specialist is woken
 * to resolve them. The merge is never pushed — this is a local workspace operation.
 *
 * Auto-commits any uncommitted changes before merging (with safety verification).
 */
export async function syncMainIntoWorkspace(
  projectPath: string,
  issueId: string,
): Promise<SyncMainResult> {
  console.log(`[sync-main] Starting sync of main into workspace for ${issueId}`);
  logActivity('sync_main_start', `Starting sync for ${issueId}`);

  // Pre-flight: auto-commit uncommitted changes before merge
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (statusOut.trim()) {
      console.log(`[sync-main] Uncommitted changes detected, auto-committing...`);
      logActivity('sync_main_auto_commit', `Auto-committing uncommitted changes before sync`);
      try {
        await execAsync('git add -A && git commit -m "WIP: auto-commit before sync with main"', {
          cwd: projectPath,
          encoding: 'utf-8',
        });
        console.log(`[sync-main] Auto-commit successful`);
      } catch (commitErr: any) {
        const message = `Failed to auto-commit uncommitted changes: ${commitErr.message}`;
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }

      // Verify commit succeeded — abort if uncommitted changes still exist
      const { stdout: postCommitStatus } = await execAsync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      if (postCommitStatus.trim()) {
        const message = 'Uncommitted changes remain after auto-commit — aborting sync';
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    }
  } catch (error: any) {
    return { success: false, reason: `Failed to check git status: ${error.message}` };
  }

  // Clean up stale git lock files
  try {
    const lockCleanup = await cleanupStaleLocks(projectPath);
    if (lockCleanup.found.length > 0) {
      console.log(`[sync-main] Found ${lockCleanup.found.length} lock file(s)`);
      if (lockCleanup.removed.length > 0) {
        console.log(`[sync-main] Cleaned up ${lockCleanup.removed.length} stale lock file(s)`);
        logActivity('git_lock_cleanup', `Removed ${lockCleanup.removed.length} stale lock file(s)`);
      }
      if (lockCleanup.errors.some((e: { file: string; error: string }) => e.error.includes('Git processes are running'))) {
        const message = 'Git processes are still running — cannot safely start sync';
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    }
  } catch (lockErr: any) {
    console.warn(`[sync-main] Lock cleanup warning: ${lockErr.message} (continuing)`);
  }

  // Fetch latest main
  try {
    console.log(`[sync-main] Fetching origin/main...`);
    await execAsync('git fetch origin main', { cwd: projectPath, encoding: 'utf-8' });
  } catch (error: any) {
    return { success: false, reason: `Failed to fetch origin/main: ${error.message}` };
  }

  // Attempt the merge
  let mergeOutput = '';
  let hasConflicts = false;
  try {
    const result = await execAsync('git merge origin/main', { cwd: projectPath, encoding: 'utf-8' });
    mergeOutput = (result.stdout || '') + (result.stderr || '');
  } catch (error: any) {
    mergeOutput = (error.stdout || '') + (error.stderr || '');
    hasConflicts = true;
  }

  // Already up to date?
  if (mergeOutput.includes('Already up to date') || mergeOutput.includes('Already up-to-date')) {
    console.log(`[sync-main] Already up to date`);
    logActivity('sync_main_noop', `${issueId} already up to date with main`);
    return { success: true, alreadyUpToDate: true };
  }

  if (!hasConflicts) {
    // Clean merge — collect stats
    console.log(`[sync-main] Clean merge completed`);
    logActivity('sync_main_success', `Clean merge of main into ${issueId}`);

    let changedFiles: string[] = [];
    let commitCount = 0;
    try {
      const { stdout: diffFiles } = await execAsync(
        'git diff --name-only ORIG_HEAD HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD',
        { cwd: projectPath, encoding: 'utf-8' },
      );
      changedFiles = diffFiles.trim().split('\n').filter(f => f.length > 0);
    } catch { /* non-fatal */ }
    try {
      const { stdout: logOut } = await execAsync(
        'git log ORIG_HEAD..HEAD --oneline 2>/dev/null || echo ""',
        { cwd: projectPath, encoding: 'utf-8' },
      );
      commitCount = logOut.trim().split('\n').filter(l => l.length > 0).length;
    } catch { /* non-fatal */ }

    return { success: true, commitCount, changedFiles };
  }

  // Conflict case — delegate to merge-agent specialist
  const conflictFiles = await getConflictFiles(projectPath);
  console.log(`[sync-main] ${conflictFiles.length} conflict(s), waking merge-agent...`);
  logActivity('sync_main_conflicts', `${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}`);

  const workspaceBranch = await execAsync('git branch --show-current', { cwd: projectPath, encoding: 'utf-8' })
    .then(r => r.stdout.trim())
    .catch(() => `feature/${issueId.toLowerCase()}`);

  // Build prompt from template
  const promptPath = join(__dirname, 'prompts', 'sync-main.md');
  let taskPrompt: string;
  try {
    const template = readFileSync(promptPath, 'utf-8');
    taskPrompt = template
      .replace(/{{projectPath}}/g, projectPath)
      .replace(/{{workspaceBranch}}/g, workspaceBranch)
      .replace(/{{issueId}}/g, issueId)
      .replace(/{{conflictFiles}}/g, conflictFiles.map(f => `- ${f}`).join('\n'));
  } catch (templateErr: any) {
    console.error(`[sync-main] Could not load sync-main.md template: ${templateErr.message}`);
    logActivity('sync_main_error', `Template load failed: ${templateErr.message}`);
    try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
    return { success: false, conflictFiles, reason: 'Internal error: sync-main prompt template not found' };
  }

  // Wake the merge-agent specialist
  const wakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
    waitForReady: true,
    startIfNotRunning: true,
    issueId,
  });

  if (!wakeResult.success) {
    try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
    const message = `Failed to wake merge-agent specialist: ${wakeResult.message}`;
    console.error(`[sync-main] ${message}`);
    logActivity('sync_main_error', message);
    return { success: false, conflictFiles, reason: message };
  }

  console.log(`[sync-main] Specialist woken, waiting for conflict resolution...`);
  logActivity('sync_main_agent_woken', `Agent resolving ${conflictFiles.length} conflict(s) for ${issueId}`);

  // Poll tmux output for MERGE_RESULT markers
  const tmuxSession = getTmuxSessionName('merge-agent');
  const startTime = Date.now();
  const POLL_INTERVAL = 5000;
  const SYNC_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  let lastOutput = '';

  while (Date.now() - startTime < SYNC_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    const output = await captureTmuxOutput(tmuxSession);
    if (output !== lastOutput) {
      lastOutput = output;
      const hasStructured = output.includes('MERGE_RESULT:');
      const lowerOutput = output.toLowerCase();
      const hasHumanReadable =
        lowerOutput.includes('merge task complete') ||
        lowerOutput.includes('successfully merged') ||
        lowerOutput.includes('merge complete') ||
        lowerOutput.includes('merge failed') ||
        lowerOutput.includes('merge task failed');

      if (hasStructured || hasHumanReadable) {
        const agentResult = parseAgentOutput(output);

        if (agentResult.success) {
          // Verify no leftover conflict markers
          const remaining = await scanForConflictMarkers(projectPath);
          if (remaining.length > 0) {
            try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
            const msg = `Agent reported success but ${remaining.length} conflict marker(s) remain in: ${remaining.join(', ')}`;
            console.error(`[sync-main] ${msg}`);
            logActivity('sync_main_markers_remain', msg);
            return { success: false, conflictFiles, reason: msg };
          }

          console.log(`[sync-main] ✓ Conflicts resolved by agent`);
          logActivity('sync_main_success', `Merge agent resolved conflicts for ${issueId}`);

          // Collect stats
          let changedFiles: string[] = [];
          let commitCount = 0;
          try {
            const { stdout: diffFiles } = await execAsync(
              'git diff --name-only ORIG_HEAD HEAD',
              { cwd: projectPath, encoding: 'utf-8' },
            );
            changedFiles = diffFiles.trim().split('\n').filter(f => f.length > 0);
            const { stdout: logOut } = await execAsync(
              'git log ORIG_HEAD..HEAD --oneline',
              { cwd: projectPath, encoding: 'utf-8' },
            );
            commitCount = logOut.trim().split('\n').filter(l => l.length > 0).length;
          } catch { /* non-fatal */ }

          return { success: true, commitCount, changedFiles };
        } else {
          // Agent failed — ensure merge is aborted
          try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
          console.log(`[sync-main] ✗ Agent could not resolve conflicts`);
          logActivity('sync_main_agent_failed', `Agent failed to resolve conflicts for ${issueId}`);
          return {
            success: false,
            conflictFiles,
            reason: agentResult.reason || 'Merge agent could not resolve conflicts',
          };
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0) {
      console.log(`[sync-main] Still waiting for agent... (${elapsed}s elapsed)`);
    }
  }

  // Timeout
  try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
  logActivity('sync_main_timeout', `Sync timed out for ${issueId}`);
  return {
    success: false,
    conflictFiles,
    reason: `Timeout: merge agent did not complete within ${SYNC_TIMEOUT_MS / 60000} minutes`,
  };
}

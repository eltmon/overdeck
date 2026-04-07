/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { sendKeysAsync, sessionExists } from '../tmux.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  PANOPTICON_HOME,
} from '../paths.js';
import { resolveGitHubIssue } from '../tracker-utils.js';

import {
  getSessionId,
  recordWake,
  getTmuxSessionName,
  wakeSpecialist,
  spawnEphemeralSpecialist,
  isRunning,
} from './specialists.js';
import { resolveProjectFromIssue } from '../projects.js';
import { runMergeValidation, autoRevertMerge, runQualityGates } from './validation.js';
import { loadProjectsConfig } from '../projects.js';
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

  // Wrap in orchestration markers for context delineation
  return `<!-- panopticon:orchestration-context-start -->\n${prompt}\n<!-- panopticon:orchestration-context-end -->`;
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
 * Notify TLDR daemon to reindex changed files after merge
 */
export async function notifyTldrDaemon(projectPath: string, sourceBranch: string): Promise<void> {
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
 * Post-merge cleanup: move PRD, close PR, move issue to Done, report merge, compact beads.
 *
 * Moves the issue to Done on the tracker so it appears in the Done column.
 * Does NOT tear down the workspace or apply the closed-out label — the human
 * close-out ceremony handles that separately.
 *
 * IDEMPOTENT: Safe to call multiple times for the same issueId. Tracks completed
 * issues and returns immediately on re-entry. This is defense-in-depth against
 * the infinite loop that burned 24,626 Linear API calls (PAN-328).
 */

// Defense-in-depth: track issues that have completed postMergeLifecycle.
// Prevents re-execution even if caller guards fail. Persists for server lifetime.
const _completedPostMerge = new Set<string>();

// Circuit breaker for issue tracker close operations.
// After MAX_CLOSE_RETRIES consecutive failures, stop trying to close the issue
// on the tracker. The issue can be closed manually via the dashboard close-out ceremony.
const _closeIssueFailures = new Map<string, number>();
const MAX_CLOSE_RETRIES = 3;

export async function postMergeLifecycle(issueId: string, projectPath: string, sourceBranch?: string, options?: { skipDeploy?: boolean }): Promise<void> {
  // Guard 1: skip if already completed (defense-in-depth against infinite loops)
  if (_completedPostMerge.has(issueId)) {
    console.log(`[merge-agent] postMergeLifecycle already completed for ${issueId}, skipping`);
    return;
  }

  // Step 0: Write pending lifecycle file and spawn detached deploy script.
  // The deploy script rebuilds dist/, kills this server, and starts a fresh process.
  // The fresh process reads the pending file on startup and runs the lifecycle steps
  // with correct module chunk references (no ERR_MODULE_NOT_FOUND after merge).
  //
  // Skip this step when we ARE the fresh process (called from processPendingLifecycle) —
  // dynamic imports already resolve correctly and spawning again would create an infinite loop.
  if (!options?.skipDeploy) {
    const pendingFile = join(PANOPTICON_HOME, 'pending-post-merge.json');
    const repoRoot = __dirname.includes('/src/')
      ? __dirname.replace(/\/src\/.*$/, '')
      : __dirname.replace(/\/dist\/.*$/, '').replace(/\/lib\/.*$/, '');
    const deployScript = join(repoRoot, 'scripts', 'post-merge-deploy.sh');

    try {
      const pendingData = JSON.stringify({
        issueId,
        projectPath,
        sourceBranch: sourceBranch ?? '',
        timestamp: Date.now(),
      });
      await writeFile(pendingFile, pendingData, 'utf-8');
      console.log(`[merge-agent] Wrote pending lifecycle file: ${pendingFile}`);

      const child = spawn(deployScript, [repoRoot, issueId, projectPath, sourceBranch ?? ''], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`[merge-agent] Spawned detached deploy script (pid ${child.pid}) — server will restart with new build`);
      return;
    } catch (err: any) {
      console.warn(`[merge-agent] Failed to spawn deploy script: ${err.message}. Falling through to in-process lifecycle (may fail on stale chunks).`);
    }
  }

  console.log(`[merge-agent] Running post-merge cleanup for ${issueId}`);

  // 1. Move PRD from active to completed (via lifecycle module)
  try {
    const { movePrd } = await import('../lifecycle/archive-planning.js');
    const prdResult = await movePrd({ issueId, projectPath });
    if (prdResult.success && !prdResult.skipped) {
      console.log(`[merge-agent] ✓ ${prdResult.details?.join('; ')}`);
      logActivity('prd_moved', `Moved ${issueId} PRD to completed directory`);
    } else if (prdResult.skipped) {
      console.log(`[merge-agent] PRD move skipped: ${prdResult.details?.join('; ')}`);
    } else {
      console.warn(`[merge-agent] PRD move failed: ${prdResult.error}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not move PRD: ${err}`);
  }

  // 2. Remove ephemeral planning artifacts from main (via lifecycle module)
  try {
    const { cleanPlanningArtifacts } = await import('../lifecycle/clean-planning.js');
    const cleanResult = await cleanPlanningArtifacts({ issueId, projectPath });
    if (cleanResult.success && !cleanResult.skipped) {
      console.log(`[merge-agent] ✓ ${cleanResult.details?.join('; ')}`);
      logActivity('planning_artifacts_cleaned', cleanResult.details?.join('; ') || 'Planning artifacts removed');
    } else if (cleanResult.skipped) {
      console.log(`[merge-agent] Planning artifact cleanup skipped: ${cleanResult.details?.join('; ')}`);
    } else {
      console.warn(`[merge-agent] Planning artifact cleanup failed: ${cleanResult.error}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not clean planning artifacts: ${err}`);
  }

  // 3. Clean up workflow labels + apply 'merged' label (non-fatal)
  // MUST run BEFORE closing the issue — once closed on GitHub, label edits fail silently.
  // This was the root cause of in-review labels persisting after merge (PAN-453 incident).
  try {
    const { cleanupMergedLabels } = await import('../lifecycle/label-cleanup.js');
    const ghResolved = resolveGitHubIssue(issueId);
    const labelCtx = ghResolved.isGitHub
      ? { issueId, projectPath, github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
      : { issueId, projectPath };
    const labelResult = await cleanupMergedLabels(labelCtx);
    if (labelResult.success && !labelResult.skipped) {
      console.log(`[merge-agent] ✓ ${labelResult.details?.join('; ')}`);
      logActivity('labels_cleaned', labelResult.details?.join('; ') || 'Labels cleaned');
    } else if (labelResult.skipped) {
      console.log(`[merge-agent] Label cleanup skipped: ${labelResult.details?.join('; ')}`);
    } else {
      console.warn(`[merge-agent] Label cleanup failed (non-fatal): ${labelResult.error}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not clean labels: ${err}`);
  }

  // 3b. Close issue on tracker (fire-and-forget with circuit breaker)
  // This is decoupled from the merge lifecycle: failure to close the issue on the
  // tracker does NOT block the merge or cause retries. The close-out ceremony handles
  // any issues that weren't auto-closed.
  closeIssueWithCircuitBreaker(issueId, projectPath);

  // 4. Compact old beads (via lifecycle module)
  try {
    const { compactBeads } = await import('../lifecycle/compact-beads.js');
    const beadsResult = await compactBeads({ issueId, projectPath });
    if (beadsResult.success && !beadsResult.skipped) {
      console.log(`[merge-agent] ✓ ${beadsResult.details?.join('; ')}`);
      logActivity('beads_compaction_complete', beadsResult.details?.join('; ') || 'Beads compacted');
    }
  } catch (err) {
    console.warn(`[merge-agent] Beads compaction failed: ${err}`);
  }

  // 5. Kill work agent tmux session to free resources (non-fatal)
  // Stopped agents with live tmux sessions leak memory (Claude + MCP processes stay resident)
  try {
    const { getAgentState, saveAgentState } = await import('../agents.js');
    const { killSession, sessionExists } = await import('../tmux.js');
    const agentId = `agent-${issueId.toLowerCase()}`;
    const agentState = getAgentState(agentId);
    if (agentState && sessionExists(agentId)) {
      killSession(agentId);
      agentState.status = 'stopped';
      saveAgentState(agentState);
      console.log(`[merge-agent] ✓ Killed work agent session ${agentId} to free resources`);
      logActivity('agent_session_killed', `Freed resources: killed tmux session for ${agentId}`);
    }
    // Also kill planning agent if it exists
    const planningId = `planning-${issueId.toLowerCase()}`;
    if (sessionExists(planningId)) {
      killSession(planningId);
      console.log(`[merge-agent] ✓ Killed planning agent session ${planningId}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not kill agent sessions: ${err}`);
  }

  // 6. Stop Docker containers + networks to prevent network pool exhaustion (non-fatal)
  // Orphaned Docker networks accumulate when workspaces are merged but containers are never
  // torn down, eventually exhausting Docker's address pool and blocking new workspace creation.
  try {
    const { findWorkspacePath } = await import('../lifecycle/archive-planning.js');
    const { stopWorkspaceDocker } = await import('../workspace-manager.js');
    const issueLower = issueId.toLowerCase();
    const workspacePath = findWorkspacePath(projectPath, issueLower);
    if (workspacePath) {
      const projName = basename(projectPath);
      const dockerResult = await stopWorkspaceDocker(workspacePath, projName, issueLower);
      if (dockerResult.containersFound) {
        console.log(`[merge-agent] ✓ Stopped Docker containers: ${dockerResult.steps.join('; ')}`);
        logActivity('docker_cleanup', `Stopped Docker for ${issueId}: ${dockerResult.steps.join('; ')}`);
      }
    }
  } catch (err) {
    console.warn(`[merge-agent] Docker cleanup failed (non-fatal): ${err}`);
  }

  // Mark completed BEFORE logging — prevents re-entry even if the log line triggers something
  _completedPostMerge.add(issueId);

  console.log(`[merge-agent] Post-merge cleanup completed for ${issueId}. Issue moved to Done — awaiting close-out.`);
  logActivity('merge_complete', `Merged ${issueId}. Issue moved to Done — awaiting close-out.`);
}

/**
 * Close issue on tracker with circuit breaker protection.
 * Fire-and-forget: runs asynchronously, never blocks the caller.
 * Stops retrying after MAX_CLOSE_RETRIES consecutive failures per issue.
 */
function closeIssueWithCircuitBreaker(issueId: string, projectPath: string): void {
  const failures = _closeIssueFailures.get(issueId) || 0;
  if (failures >= MAX_CLOSE_RETRIES) {
    console.log(`[merge-agent] Circuit breaker open for ${issueId} issue close (${failures} failures). Will be closed during close-out ceremony.`);
    return;
  }

  // Fire-and-forget — errors are caught and logged, never propagated
  (async () => {
    try {
      const { closeIssue } = await import('../lifecycle/close-issue.js');
      const ghResolved = resolveGitHubIssue(issueId);
      const ctx = ghResolved.isGitHub
        ? { issueId, projectPath, github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
        : { issueId, projectPath };
      const results = await closeIssue(ctx, { applyLabel: false, comment: 'Merged to main via Panopticon merge-agent' });

      let anyFailure = false;
      for (const r of results) {
        if (r.success && !r.skipped) {
          console.log(`[merge-agent] ✓ ${r.details?.join('; ')}`);
          logActivity(r.step, r.details?.join('; ') || r.step);
        } else if (!r.skipped) {
          console.warn(`[merge-agent] ✗ ${r.step} failed: ${r.error}`);
          anyFailure = true;
        }
      }

      if (anyFailure) {
        const newCount = (_closeIssueFailures.get(issueId) || 0) + 1;
        _closeIssueFailures.set(issueId, newCount);
        if (newCount >= MAX_CLOSE_RETRIES) {
          console.warn(`[merge-agent] Circuit breaker tripped for ${issueId} after ${newCount} failures. Issue close deferred to close-out ceremony.`);
        }
      } else {
        // Success — clear failure counter
        _closeIssueFailures.delete(issueId);
      }
    } catch (err) {
      const newCount = (_closeIssueFailures.get(issueId) || 0) + 1;
      _closeIssueFailures.set(issueId, newCount);
      console.warn(`[merge-agent] Could not move issue to Done (attempt ${newCount}/${MAX_CLOSE_RETRIES}): ${err}`);
    }
  })();
}

/**
 * Reset postMergeLifecycle completion tracking for an issue (used by reopen).
 */
export function resetPostMergeState(issueId: string): void {
  _completedPostMerge.delete(issueId);
  _closeIssueFailures.delete(issueId);
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
              // Validation passed — now run quality gates if configured
              console.log(`[merge-agent] ✓ Validation passed`);

              const gateResults = await runProjectQualityGates(context.projectPath, 'pre_push');
              const failedRequired = gateResults.filter(g => !g.passed && g.required);
              if (failedRequired.length > 0) {
                const failedNames = failedRequired.map(g => g.name).join(', ');
                console.log(`[merge-agent] ✗ Quality gates failed: ${failedNames}`);
                logActivity('merge_quality_gate_fail', `Quality gates failed for ${context.issueId}: ${failedNames}`);

                const revertSuccess = await autoRevertMerge(context.projectPath);
                const revertNote = revertSuccess
                  ? 'Merge auto-reverted to clean state'
                  : 'WARNING: Auto-revert failed - manual cleanup required';

                const failedResult: MergeResult = {
                  success: false,
                  validationStatus: 'FAIL',
                  reason: `Quality gate(s) failed: ${failedNames}. ${revertNote}`,
                  notes: result.notes,
                  output,
                };
                logMergeHistory(context, failedResult);
                return failedResult;
              }

              logActivity('merge_success', `Merge and validation completed for ${context.issueId}`);

              // Update result with validation status
              result.validationStatus = 'PASS';
              logMergeHistory(context, result);

              // Run post-merge cleanup (move PRD, update issue status)
              await postMergeLifecycle(context.issueId, context.projectPath, context.sourceBranch);

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
  issueId: string,
  options?: { skipDoneReport?: boolean }
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

  // 3. No-op check: if sourceBranch is already an ancestor of targetBranch, skip the merge
  try {
    await execAsync(`git fetch origin ${sourceBranch} ${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    let isAlreadyMerged = false;
    try {
      await execAsync(
        `git merge-base --is-ancestor origin/${sourceBranch} origin/${targetBranch}`,
        { cwd: projectPath, encoding: 'utf-8' }
      );
      isAlreadyMerged = true;
    } catch (e: any) {
      // exit code 1 means not an ancestor — proceed with merge
      // any other exit code is a real error; propagate it
      if (e.code !== 1) {
        throw e;
      }
    }
    if (isAlreadyMerged) {
      const message = `Branch ${sourceBranch} is already integrated into ${targetBranch} — no merge needed`;
      console.log(`[merge-agent] ${message}`);
      logActivity('merge_skipped', message);
      return { success: true, reason: message };
    }
  } catch (ancestorErr: any) {
    console.warn(`[merge-agent] Ancestor check failed: ${ancestorErr.message} (continuing)`);
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
  const skipDoneReport = options?.skipDoneReport ?? false;

  // When called from the polyrepo merge loop, the server manages overall status.
  // The merge-agent should NOT call /api/specialists/done — doing so would
  // prematurely set the issue's overall mergeStatus to 'merged' after one repo,
  // even if other repos haven't been merged yet.
  const doneReportInstructions = skipDoneReport
    ? `DO NOT call /api/specialists/done — the server manages status for this merge.
    After pushing, simply STOP. If you need to rollback, rollback and STOP.`
    : `Then report by calling the Panopticon API:
    curl -s -X POST ${apiUrl}/api/specialists/done \\
      -H "Content-Type: application/json" \\
      -d '{"specialist":"merge","issueId":"${issueId}","status":"<passed or failed>","notes":"<reason if failed>"}'

CRITICAL: You MUST call the /api/specialists/done endpoint whether you succeed or fail.`;

  const taskPrompt = `MERGE TASK for ${issueId}:

PROJECT: ${projectPath}
SOURCE BRANCH: ${sourceBranch}
TARGET BRANCH: ${targetBranch}

INSTRUCTIONS:

PHASE 1 — SYNC & BASELINE (before merge):
1. cd ${projectPath}
2. git checkout ${targetBranch}
3. git fetch origin ${targetBranch}
4. Sync local ${targetBranch} with origin/${targetBranch}:
   Run: git rev-list --left-right --count ${targetBranch}...origin/${targetBranch}
   (Output: "LOCAL_AHEAD  REMOTE_AHEAD". If REMOTE_AHEAD > 0, local is behind origin.)
   If local is behind origin (REMOTE_AHEAD > 0):
     a. git rebase origin/${targetBranch}
        (Replays local commits on top of origin — preserves linear history, no merge commits, no data loss)
     b. If rebase conflicts: abort with git rebase --abort, then STOP — human intervention needed.
     c. If rebase succeeds: continue to next step
   If local is up-to-date or ahead-only (REMOTE_AHEAD = 0): continue to next step
5. Run tests on the CURRENT ${targetBranch} to establish a baseline:
   - Use the Task tool with subagent_type="Bash" to run: npm test 2>&1 || true
   - Record the number of passing and failing tests as BASELINE_PASS and BASELINE_FAIL
   - This baseline is critical — you will compare post-merge results against it

PHASE 2 — MERGE:
6. git merge ${sourceBranch}
7. If clean merge: the merge commit is auto-created (or fast-forward). Skip to Phase 3.
8. If conflicts:
   a. Immediately abort: git merge --abort
   b. ROLLBACK — report FAILURE with note "Merge conflicts detected — work agent must rebase before merge"
   c. Do NOT attempt to manually resolve conflicts. The work agent or human must handle this.

PHASE 3 — VERIFY:
9. Build the project to verify no compile errors:
   - Use the Task tool with subagent_type="Bash" to run the build command
   - For Node.js: NODE_OPTIONS="--max-old-space-size=8192" npm run build
   - For Java/Maven: ./mvnw compile
   - Check package.json or pom.xml to determine the right command
10. Run tests using the Task tool with subagent_type="Bash":
    - For Node.js: npm test
    - Record the number of passing and failing tests as MERGE_PASS and MERGE_FAIL

PHASE 4 — DECIDE:
11. Compare results:
    - If build failed: ROLLBACK (go to step 12)
    - If MERGE_FAIL > BASELINE_FAIL (NEW test failures introduced): ROLLBACK (go to step 12)
    - If MERGE_FAIL <= BASELINE_FAIL (no new failures): PUSH (go to step 13)
    - Pre-existing failures on ${targetBranch} are NOT a reason to rollback
12. ROLLBACK: git reset --hard ORIG_HEAD
    (ORIG_HEAD is set by git at merge time — always points to pre-merge state)
    ${doneReportInstructions.includes('DO NOT') ? 'Then STOP.' : `Then report failure by calling the Panopticon API:
    curl -s -X POST ${apiUrl}/api/specialists/done \\
      -H "Content-Type: application/json" \\
      -d '{"specialist":"merge","issueId":"${issueId}","status":"failed","notes":"<reason for rollback>"}'
    Then STOP.`}
13. PUSH: git push origin ${targetBranch}
    If push is rejected (non-fast-forward / "tip of your current branch is behind"):
      a. git fetch origin ${targetBranch}
      b. git rebase origin/${targetBranch}
         (Replay on top of any new remote commits — safe, no data loss)
      c. If rebase conflicts: abort with git rebase --abort, ROLLBACK (go to step 12)
      d. If rebase succeeds: retry git push origin ${targetBranch}
      e. If push fails again after one retry: ROLLBACK (go to step 12)
    ${doneReportInstructions}

CRITICAL: You MUST complete this merge. The approve operation is waiting.

WHY USE SUBAGENTS FOR BUILD/TEST:
- Subagents have isolated context and won't pollute your working memory
- Build and test output can be verbose - subagents handle this cleanly
- If tests fail, the subagent returns a clear summary

DO NOT:
- Delete the feature branch (locally or remotely)
- Clean up workspaces
- Use git push --force or --force-with-lease — NEVER force-push under any circumstances
- Skip the build step - compile errors after merge are common
- Skip the baseline test run — without it you cannot distinguish new failures from pre-existing ones
- Use HEAD~1 for rollback — use ORIG_HEAD which git sets automatically at merge time
- Run git stash — the TypeScript layer handles stash/restore automatically
- Do anything beyond the sync, merge, build, test, and push steps above

Report any issues or conflicts you encountered.`;

  // Resolve project key for per-project ephemeral lifecycle (PAN-300)
  const resolvedProject = resolveProjectFromIssue(issueId);
  const mergeProjectKey = resolvedProject?.projectKey ?? null;
  const mergeSession = getTmuxSessionName('merge-agent', mergeProjectKey ?? undefined);

  if (!resolvedProject) {
    console.warn(`[merge-agent] Could not resolve project for ${issueId} — falling back to global specialist. Check projects.yaml configuration.`);
  }

  // Wait for the per-project merge-agent to be idle before sending a new task.
  // Only applies to the per-project ephemeral path — the legacy wakeSpecialist
  // path manages its own ready-wait internally via waitForReady: true.
  // Without this, sending a task to a busy specialist causes Claude's
  // "Interrupted" behavior — the running tool gets cancelled and the
  // previous merge is abandoned mid-flight.
  if (mergeProjectKey) {
    const { getAgentRuntimeState, saveAgentRuntimeState } = await import('../agents.js');
    const IDLE_POLL_INTERVAL = 3000; // 3 seconds
    const IDLE_MAX_WAIT = 360000; // 6 minutes (slightly longer than specialist timeout)
    const idleStart = Date.now();

    while (Date.now() - idleStart < IDLE_MAX_WAIT) {
      const state = getAgentRuntimeState(mergeSession);
      if (!state || state.state === 'idle' || state.state === 'suspended') {
        break; // Specialist is idle, safe to send
      }
      // Dead-session check: if runtime.json says active but tmux session is gone,
      // the specialist died without resetting state. Reset to idle and proceed immediately.
      try {
        await execAsync(`tmux has-session -t "${mergeSession}" 2>/dev/null`);
      } catch {
        // tmux has-session exits non-zero when the session does not exist
        console.log(`[merge-agent] Specialist session ${mergeSession} is dead (state was ${state.state}), resetting to idle`);
        saveAgentRuntimeState(mergeSession, { state: 'idle', lastActivity: new Date().toISOString() });
        break;
      }
      console.log(`[merge-agent] Specialist busy (state: ${state.state}, issue: ${state.currentIssue}), waiting...`);
      await new Promise(resolve => setTimeout(resolve, IDLE_POLL_INTERVAL));
    }

    // Final check after loop
    const finalState = getAgentRuntimeState(mergeSession);
    if (finalState && finalState.state !== 'idle' && finalState.state !== 'suspended') {
      console.warn(`[merge-agent] Specialist still busy after ${IDLE_MAX_WAIT / 1000}s, proceeding anyway`);
    }
  }

  // Wake the merge-agent specialist using per-project ephemeral lifecycle when possible
  let wakeResult: { success: boolean; message: string; tmuxSession?: string; error?: string };
  if (mergeProjectKey) {
    console.log(`[merge-agent] Using per-project ephemeral specialist for ${issueId} (${mergeProjectKey})`);
    wakeResult = await spawnEphemeralSpecialist(mergeProjectKey, 'merge-agent', {
      issueId,
      branch: sourceBranch,
      workspace: projectPath,
      promptOverride: taskPrompt,
    });
  } else {
    console.log(`[merge-agent] Project resolution failed, falling back to legacy global specialist for ${issueId}`);
    wakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
      waitForReady: true,
      startIfNotRunning: true,
      issueId,
    });
  }

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
  const MAX_WAIT = 15 * 60 * 1000; // 15 minutes (match MERGE_TIMEOUT_MS)
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
          // Verify it's pushed — fetch first to refresh stale tracking refs
          // (the push happens in the merge-agent's tmux session, which may not
          // update the tracking ref visible to this process)
          try {
            await execAsync(`git fetch origin ${targetBranch}`, {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 10000,
            }).catch(() => {}); // Non-fatal — fall through to rev-parse
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
                const specialistOutput = await captureTmuxOutput(mergeSession);
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
                // Validation passed — now run quality gates if configured
                const skipNote = validationResult.skipped ? ' (no validation script, specialist already validated)' : '';
                console.log(`[merge-agent] ✓ Merge validation passed${skipNote}`);

                const gateResults = await runProjectQualityGates(projectPath, 'pre_push');
                const failedRequired = gateResults.filter(g => !g.passed && g.required);
                if (failedRequired.length > 0) {
                  const failedNames = failedRequired.map(g => g.name).join(', ');
                  console.log(`[merge-agent] ✗ Quality gates failed: ${failedNames}`);
                  logActivity('merge_quality_gate_fail', `Quality gates failed for ${issueId}: ${failedNames}`);

                  const revertSuccess = await autoRevertMerge(projectPath);
                  const revertNote = revertSuccess
                    ? 'Merge auto-reverted to clean state'
                    : 'WARNING: Auto-revert failed';

                  return {
                    success: false,
                    validationStatus: 'FAIL',
                    reason: `Quality gate(s) failed: ${failedNames}. ${revertNote}`,
                  };
                }

                logActivity('merge_complete', `Merge completed by specialist${skipNote}`);

                // Run post-merge cleanup (move PRD, update issue status)
                await postMergeLifecycle(issueId, projectPath, sourceBranch);

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
      if (!(await isRunning('merge-agent', mergeProjectKey ?? undefined))) {
        console.error(`[merge-agent] Specialist stopped unexpectedly — checking for stranded merge commit`);
        logActivity('merge_error', 'Specialist stopped unexpectedly');

        // Salvage: if the specialist merged locally but died before pushing, push it ourselves
        const salvageResult = await salvageStrandedMerge(projectPath, targetBranch, headBefore, issueId, logActivity);
        if (salvageResult) return salvageResult;

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

  // Timeout — same salvage check
  console.error(`[merge-agent] Timeout waiting for merge completion — checking for stranded merge commit`);
  logActivity('merge_timeout', 'Timeout waiting for specialist to complete merge');

  const salvageResult = await salvageStrandedMerge(projectPath, targetBranch, headBefore, issueId, logActivity);
  if (salvageResult) return salvageResult;

  return {
    success: false,
    reason: 'Timeout waiting for merge-agent specialist to complete merge (15 minutes)',
  };
}

/**
 * Rebase a feature branch onto a base branch and push, using the merge-agent
 * specialist for conflict resolution.
 *
 * Used by the PR-based merge flow: triggerMerge() calls this to prepare the
 * feature branch, then calls `gh pr merge --squash` once the rebase is done.
 */
export async function spawnRebaseAgentForBranch(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Promise<MergeResult> {
  console.log(`[merge-agent] Starting rebase of ${featureBranch} onto ${baseBranch} for ${issueId}`);
  logActivity('rebase_start', `Rebasing ${featureBranch} onto ${baseBranch} for ${issueId}`);

  // Pre-flight: verify feature branch is pushed to remote
  try {
    const { stdout: remoteBranches } = await execAsync(
      `git ls-remote --heads origin ${featureBranch}`,
      { cwd: workspacePath, encoding: 'utf-8' },
    );
    if (!remoteBranches.trim()) {
      const message = `Branch ${featureBranch} is not pushed to remote`;
      console.error(`[merge-agent] ${message}`);
      return { success: false, reason: message };
    }
  } catch {
    const message = `Cannot verify remote branch ${featureBranch}`;
    console.error(`[merge-agent] ${message}`);
    return { success: false, reason: message };
  }

  // Record current remote HEAD of feature branch to detect rebase completion
  let headBefore: string;
  try {
    await execAsync(`git fetch origin ${featureBranch}`, { cwd: workspacePath, encoding: 'utf-8' });
    const { stdout } = await execAsync(`git rev-parse origin/${featureBranch}`, {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    headBefore = stdout.trim();
  } catch (err: any) {
    return { success: false, reason: `Failed to get remote HEAD: ${err.message}` };
  }

  // Build rebase task prompt
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;

  const taskPrompt = `REBASE TASK for ${issueId}:

WORKSPACE: ${workspacePath}
FEATURE BRANCH: ${featureBranch}
BASE BRANCH: ${baseBranch}

INSTRUCTIONS:

1. cd ${workspacePath}
2. git fetch origin ${baseBranch}
3. Remove ephemeral planning artifacts before rebase (they always conflict):
   git rm -rf .planning/ 2>/dev/null; git commit -m "chore: remove ephemeral planning artifacts before rebase" --allow-empty 2>/dev/null
4. git rebase origin/${baseBranch}
5. If rebase has conflicts in SOURCE CODE files (src/, packages/, tests/, scripts/):
   a. Immediately abort: git rebase --abort
   b. Report FAILURE — do NOT attempt to resolve conflicts manually
   c. The work agent or a human must resolve conflicts before merge can proceed
6. If rebase succeeds cleanly (or only had .planning/ conflicts which were already removed): git push --force-with-lease origin ${featureBranch}
6. Report completion by calling the Panopticon API:
   curl -s -X POST ${apiUrl}/api/specialists/done \\
     -H "Content-Type: application/json" \\
     -d '{"specialist":"merge","issueId":"${issueId}","status":"passed","notes":"Rebase onto ${baseBranch} complete"}'

IMPORTANT:
- Work ONLY in ${workspacePath} — do NOT modify the main repo
- Do NOT run git merge — this is a rebase, not a merge
- Do NOT run build or tests — CI handles validation after PR merge
- Use --force-with-lease (never --force) for the push
- Report completion immediately after the push

IF REBASE FAILS (conflicts):
After aborting, report failure so the work agent can fix it:
\`\`\`bash
curl -s -X POST ${apiUrl}/api/specialists/done \\
  -H "Content-Type: application/json" \\
  -d '{"specialist":"merge","issueId":"${issueId}","status":"failed","notes":"Rebase conflicts with main — work agent must run: git fetch origin main && git rebase origin/main, resolve conflicts, then resubmit"}'
\`\`\`

CRITICAL: You MUST call the /api/specialists/done endpoint whether you succeed or fail.`;

  // Resolve project for per-project ephemeral specialist
  const resolvedProject = resolveProjectFromIssue(issueId);
  const mergeProjectKey = resolvedProject?.projectKey ?? null;
  const mergeSession = getTmuxSessionName('merge-agent', mergeProjectKey ?? undefined);

  if (!resolvedProject) {
    console.warn(`[merge-agent] Could not resolve project for ${issueId} — using global specialist`);
  }

  // Wait for specialist to be idle (same as spawnMergeAgentForBranches)
  if (mergeProjectKey) {
    const { getAgentRuntimeState, saveAgentRuntimeState } = await import('../agents.js');
    const IDLE_POLL_INTERVAL = 3000;
    const IDLE_MAX_WAIT = 360000;
    const idleStart = Date.now();

    while (Date.now() - idleStart < IDLE_MAX_WAIT) {
      const state = getAgentRuntimeState(mergeSession);
      if (!state || state.state === 'idle' || state.state === 'suspended') break;
      try {
        await execAsync(`tmux has-session -t "${mergeSession}" 2>/dev/null`);
      } catch {
        saveAgentRuntimeState(mergeSession, { state: 'idle', lastActivity: new Date().toISOString() });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, IDLE_POLL_INTERVAL));
    }
  }

  // Wake the merge-agent specialist
  let wakeResult: { success: boolean; message: string };
  if (mergeProjectKey) {
    wakeResult = await spawnEphemeralSpecialist(mergeProjectKey, 'merge-agent', {
      issueId,
      branch: featureBranch,
      workspace: workspacePath,
      promptOverride: taskPrompt,
    });
  } else {
    wakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
      waitForReady: true,
      startIfNotRunning: true,
      issueId,
    });
  }

  if (!wakeResult.success) {
    return {
      success: false,
      reason: `Failed to wake merge-agent specialist: ${wakeResult.message}`,
    };
  }

  console.log(`[merge-agent] Rebase specialist woken for ${issueId}, polling for completion...`);

  // Poll for rebase completion: remote feature branch HEAD should change after rebase + push
  const POLL_INTERVAL = 5000;
  const MAX_WAIT = 10 * 60 * 1000; // 10 minutes

  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    try {
      await execAsync(`git fetch origin ${featureBranch}`, {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
      }).catch(() => {});

      const { stdout: remoteHeadRaw } = await execAsync(
        `git rev-parse origin/${featureBranch}`,
        { cwd: workspacePath, encoding: 'utf-8' },
      );
      const remoteHead = remoteHeadRaw.trim();

      if (remoteHead !== headBefore) {
        console.log(`[merge-agent] Rebase complete for ${issueId}, new remote HEAD: ${remoteHead}`);
        logActivity('rebase_complete', `Rebase completed for ${issueId}`);
        return { success: true, reason: 'Rebase completed successfully' };
      }
    } catch {
      // Continue polling
    }

    // Check if specialist stopped
    if (!(await isRunning('merge-agent', mergeProjectKey ?? undefined))) {
      // Final check: maybe rebase succeeded just before specialist stopped
      try {
        await execAsync(`git fetch origin ${featureBranch}`, {
          cwd: workspacePath,
          encoding: 'utf-8',
        }).catch(() => {});
        const { stdout } = await execAsync(`git rev-parse origin/${featureBranch}`, {
          cwd: workspacePath,
          encoding: 'utf-8',
        });
        if (stdout.trim() !== headBefore) {
          console.log(`[merge-agent] Rebase detected after specialist stopped for ${issueId}`);
          return { success: true, reason: 'Rebase completed (detected after specialist stopped)' };
        }
      } catch {}

      return {
        success: false,
        reason: 'merge-agent specialist stopped before completing rebase',
      };
    }
  }

  logActivity('rebase_timeout', `Rebase timed out for ${issueId}`);
  return {
    success: false,
    reason: 'Timeout waiting for rebase to complete (10 minutes)',
  };
}

/**
 * Salvage a stranded merge commit — if the specialist merged locally but died
 * before pushing, detect the unpushed merge and push it ourselves.
 *
 * Returns a success result if salvaged, or null if nothing to salvage.
 */
async function salvageStrandedMerge(
  projectPath: string,
  targetBranch: string,
  headBefore: string,
  issueId: string,
  logActivity: (action: string, detail: string) => void,
): Promise<{ success: boolean; reason?: string } | null> {
  try {
    const { stdout: currentHeadRaw } = await execAsync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    const currentHead = currentHeadRaw.trim();

    if (currentHead === headBefore) {
      // No local merge happened — nothing to salvage
      return null;
    }

    // Local HEAD changed — check if it's ahead of remote
    await execAsync(`git fetch origin ${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).catch(() => {});

    const { stdout: remoteHeadRaw } = await execAsync(`git rev-parse origin/${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    if (remoteHeadRaw.trim() === currentHead) {
      // Already pushed (maybe by another process)
      console.log(`[merge-agent] Salvage check: merge already pushed`);
      return { success: true };
    }

    // Stranded merge detected — push it
    console.log(`[merge-agent] SALVAGING stranded merge for ${issueId}: local HEAD ${currentHead.slice(0, 8)} != remote ${remoteHeadRaw.trim().slice(0, 8)}`);
    logActivity('merge_salvage', `Pushing stranded merge commit ${currentHead.slice(0, 8)} for ${issueId}`);

    await execAsync(`git push origin ${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
    });

    console.log(`[merge-agent] Salvage push successful for ${issueId}`);
    logActivity('merge_salvage_success', `Stranded merge pushed successfully`);
    return { success: true };
  } catch (error: any) {
    console.error(`[merge-agent] Salvage failed: ${error.message}`);
    logActivity('merge_salvage_failed', `Salvage push failed: ${error.message}`);
    return null;
  }
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

  // Wake the merge-agent specialist using per-project ephemeral lifecycle when possible
  const syncResolvedProject = resolveProjectFromIssue(issueId);
  const syncProjectKey = syncResolvedProject?.projectKey ?? null;
  let syncWakeResult: { success: boolean; message: string; tmuxSession?: string; error?: string };
  if (syncProjectKey) {
    syncWakeResult = await spawnEphemeralSpecialist(syncProjectKey, 'merge-agent', {
      issueId,
      branch: workspaceBranch,
      workspace: projectPath,
      promptOverride: taskPrompt,
    });
  } else {
    syncWakeResult = await wakeSpecialist('merge-agent', taskPrompt, {
      waitForReady: true,
      startIfNotRunning: true,
      issueId,
    });
  }

  if (!syncWakeResult.success) {
    try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
    const message = `Failed to wake merge-agent specialist: ${syncWakeResult.message}`;
    console.error(`[sync-main] ${message}`);
    logActivity('sync_main_error', message);
    return { success: false, conflictFiles, reason: message };
  }

  console.log(`[sync-main] Specialist woken, waiting for conflict resolution...`);
  logActivity('sync_main_agent_woken', `Agent resolving ${conflictFiles.length} conflict(s) for ${issueId}`);

  // Poll tmux output for MERGE_RESULT markers
  const tmuxSession = getTmuxSessionName('merge-agent', syncProjectKey ?? undefined);
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

/**
 * Look up and run quality gates for the project at projectPath.
 * Returns empty array if no quality gates are configured.
 *
 * In polyrepo mode (projectPath is a sub-repo of project.path), only gates
 * whose `path` field matches the relative sub-repo path are run. Gates with
 * no `path` field are skipped in polyrepo context.
 */
export async function runProjectQualityGates(
  projectPath: string,
  phase: 'pre_push' | 'post_push'
): Promise<import('./validation.js').QualityGateResult[]> {
  try {
    const config = loadProjectsConfig();
    // Find the project whose path matches
    const project = Object.values(config.projects).find(p => projectPath.startsWith(p.path));
    if (!project?.quality_gates || Object.keys(project.quality_gates).length === 0) {
      console.log(`[merge-agent] No quality gates configured for ${projectPath}`);
      return [];
    }

    // Detect polyrepo context: if projectPath is a subdirectory of project.path,
    // repoRelPath is non-empty (e.g., 'frontend' or 'backend').
    const repoRelPath = relative(project.path, projectPath);

    let gatesToRun = project.quality_gates;
    if (repoRelPath && !repoRelPath.startsWith('..')) {
      // Polyrepo: only run gates whose path matches this sub-repo
      const filtered = Object.entries(project.quality_gates).filter(
        ([, gate]) => gate.path === repoRelPath
      );
      if (filtered.length === 0) {
        console.log(`[merge-agent] No quality gates configured for repo path "${repoRelPath}"`);
        return [];
      }
      gatesToRun = Object.fromEntries(filtered);
      console.log(
        `[merge-agent] Polyrepo: running ${Object.keys(gatesToRun).length} gate(s) for path "${repoRelPath}"`
      );
    }

    console.log(`[merge-agent] Running ${phase} quality gates for project "${project.name}"`);
    return await runQualityGates(gatesToRun, projectPath, phase);
  } catch (error: any) {
    console.error(`[merge-agent] Failed to load quality gates: ${error.message}`);
    return [];
  }
}

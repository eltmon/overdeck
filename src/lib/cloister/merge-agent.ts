/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { PANOPTICON_HOME } from '../paths.js';
import {
  getSessionId,
  setSessionId,
  recordWake,
  getTmuxSessionName,
} from './specialists.js';

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
  const templatePath = join(process.cwd(), 'src/lib/cloister/prompts/merge-agent.md');

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
      notes,
      output,
    };
  } else if (mergeResult === 'FAILURE') {
    return {
      success: false,
      failedFiles,
      reason,
      notes,
      output,
    };
  } else {
    // No result markers found - assume failure
    return {
      success: false,
      reason: 'Agent did not report result in expected format',
      output,
    };
  }
}

/**
 * Get conflict files from git status
 */
function getConflictFiles(projectPath: string): string[] {
  try {
    const status = execSync('git diff --name-only --diff-filter=U', {
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
 * Spawn merge-agent to resolve conflicts
 *
 * @param context - Merge conflict context
 * @returns Promise that resolves with merge result
 */
export async function spawnMergeAgent(context: MergeConflictContext): Promise<MergeResult> {
  console.log(`[merge-agent] Starting conflict resolution for ${context.issueId}`);

  // Detect test command if not provided
  if (!context.testCommand) {
    context.testCommand = detectTestCommand(context.projectPath);
  }

  // Get existing session ID
  const sessionId = getSessionId('merge-agent');

  // Build prompt
  const prompt = buildMergePrompt(context);

  // Build Claude command args
  const args = ['--model', 'sonnet', '--print', '-p', prompt];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  console.log(`[merge-agent] Session: ${sessionId || 'new session'}`);
  console.log(`[merge-agent] Test command: ${context.testCommand}`);

  // Spawn Claude process
  const proc = spawn('claude', args, {
    cwd: context.projectPath,
    env: {
      ...process.env,
      PANOPTICON_AGENT_ID: 'merge-agent',
    },
  });

  // Capture output
  let output = '';
  let errorOutput = '';

  proc.stdout?.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    // Also stream to console for visibility
    process.stdout.write(chunk);
  });

  proc.stderr?.on('data', (data) => {
    const chunk = data.toString();
    errorOutput += chunk;
    process.stderr.write(chunk);
  });

  // Create timeout promise
  const timeoutPromise = new Promise<MergeResult>((_, reject) => {
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('merge-agent timeout after 15 minutes'));
    }, MERGE_TIMEOUT_MS);
  });

  // Create completion promise
  const completionPromise = new Promise<MergeResult>((resolve, reject) => {
    proc.on('close', (code) => {
      console.log(`[merge-agent] Process exited with code ${code}`);

      // Try to extract session ID from output if this was a new session
      if (!sessionId && output) {
        // Look for session ID in output (Claude Code prints it)
        const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
        if (sessionMatch) {
          const newSessionId = sessionMatch[1];
          setSessionId('merge-agent', newSessionId);
          recordWake('merge-agent', newSessionId);
          console.log(`[merge-agent] Captured session ID: ${newSessionId}`);
        }
      } else if (sessionId) {
        recordWake('merge-agent');
      }

      // Parse output for results
      const result = parseAgentOutput(output);

      // Log to history
      logMergeHistory(context, result, sessionId || undefined);

      resolve(result);
    });

    proc.on('error', (error) => {
      console.error(`[merge-agent] Process error:`, error);
      reject(error);
    });
  });

  // Race between timeout and completion
  try {
    const result = await Promise.race([completionPromise, timeoutPromise]);
    return result;
  } catch (error: any) {
    console.error(`[merge-agent] Failed:`, error);

    const result: MergeResult = {
      success: false,
      reason: error.message || 'Unknown error',
      output: output || errorOutput,
    };

    logMergeHistory(context, result, sessionId || undefined);

    return result;
  }
}

/**
 * Spawn merge-agent with conflict detection
 *
 * Convenience function that detects conflicts and spawns the agent.
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
  // Get conflict files
  const conflictFiles = getConflictFiles(projectPath);

  if (conflictFiles.length === 0) {
    return {
      success: false,
      reason: 'No conflict files detected',
    };
  }

  const context: MergeConflictContext = {
    projectPath,
    sourceBranch,
    targetBranch,
    conflictFiles,
    issueId,
  };

  return spawnMergeAgent(context);
}

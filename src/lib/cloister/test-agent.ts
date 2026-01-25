/**
 * Test Agent - Automatic test execution and analysis using Claude Code
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
} from './specialists.js';
import { loadCloisterConfig } from './config.js';

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const TEST_HISTORY_DIR = join(SPECIALISTS_DIR, 'test-agent');
const TEST_HISTORY_FILE = join(TEST_HISTORY_DIR, 'history.jsonl');

/**
 * Context for a test execution request
 */
export interface TestContext {
  projectPath: string;
  issueId: string;
  branch: string;
  testCommand?: string; // Explicit test command override
  workspace?: string;
  context?: Record<string, any>;
}

/**
 * Test failure details
 */
export interface TestFailure {
  file?: string;
  testName: string;
  error: string;
}

/**
 * Result of test agent execution
 */
export interface TestResult {
  success: boolean;
  testResult: 'PASS' | 'FAIL' | 'ERROR';
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failures?: TestFailure[];
  fixAttempted: boolean;
  fixResult: 'SUCCESS' | 'FAILED' | 'NOT_ATTEMPTED';
  notes?: string;
  output?: string;
  detectedTestCommand?: string;
}

/**
 * Test history entry
 */
interface TestHistoryEntry {
  timestamp: string;
  issueId: string;
  branch: string;
  projectPath: string;
  testCommand?: string;
  result: TestResult;
  sessionId?: string;
}

/**
 * Timeout for test agent in milliseconds (15 minutes)
 */
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Detect test command from project structure
 *
 * Priority order:
 * 1. Explicit config from cloister.toml
 * 2. package.json scripts.test
 * 3. File pattern detection (jest, vitest, pytest, cargo, mvn, go)
 *
 * @param projectPath - Project root path
 * @returns Detected test command or 'auto' if not found
 */
export function detectTestCommand(projectPath: string): string {
  // Check cloister config first
  try {
    const config = loadCloisterConfig();
    if (config.specialists?.test_agent?.test_command) {
      return config.specialists.test_agent.test_command;
    }
  } catch {
    // Config not available, continue with auto-detection
  }

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

  // Check for Jest config
  const jestConfigs = ['jest.config.js', 'jest.config.ts', 'jest.config.json', 'jest.config.mjs'];
  if (jestConfigs.some((config) => existsSync(join(projectPath, config)))) {
    return 'npm test'; // or 'npx jest' if npm test is not available
  }

  // Check for Vitest config
  const vitestConfigs = ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'];
  if (vitestConfigs.some((config) => existsSync(join(projectPath, config)))) {
    return 'npm test'; // or 'npx vitest' if npm test is not available
  }

  // Check for pytest (Python)
  const pytestFiles = ['pytest.ini', 'setup.py', 'pyproject.toml'];
  if (pytestFiles.some((file) => existsSync(join(projectPath, file)))) {
    return 'pytest';
  }

  // Check for Cargo.toml (Rust)
  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    return 'cargo test';
  }

  // Check for pom.xml (Java/Maven)
  if (existsSync(join(projectPath, 'pom.xml'))) {
    return 'mvn test';
  }

  // Check for build.gradle (Java/Gradle)
  if (existsSync(join(projectPath, 'build.gradle')) || existsSync(join(projectPath, 'build.gradle.kts'))) {
    return 'gradle test';
  }

  // Check for go.mod (Go)
  if (existsSync(join(projectPath, 'go.mod'))) {
    return 'go test ./...';
  }

  // No test command detected
  return 'auto';
}

/**
 * Build the prompt for test-agent
 */
function buildTestPrompt(context: TestContext): string {
  const templatePath = join(__dirname, 'prompts', 'test-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Test agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Detect test command if not provided
  const testCommand = context.testCommand || detectTestCommand(context.projectPath);

  // Replace template variables
  const prompt = template
    .replace(/\{\{projectPath\}\}/g, context.projectPath)
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(/\{\{branch\}\}/g, context.branch)
    .replace(/\{\{testCommand\}\}/g, testCommand);

  return prompt;
}

/**
 * Parse result markers from agent output
 */
function parseAgentOutput(output: string): TestResult {
  const lines = output.split('\n');

  let testResult: 'PASS' | 'FAIL' | 'ERROR' | null = null;
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let failures: TestFailure[] = [];
  let fixAttempted = false;
  let fixResult: 'SUCCESS' | 'FAILED' | 'NOT_ATTEMPTED' = 'NOT_ATTEMPTED';
  let notes = '';
  let detectedTestCommand = '';

  let inFailuresSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match TEST_RESULT
    if (trimmed.startsWith('TEST_RESULT:')) {
      const value = trimmed.substring('TEST_RESULT:'.length).trim();
      if (value === 'PASS' || value === 'FAIL' || value === 'ERROR') {
        testResult = value;
      }
    }

    // Match TESTS_RUN
    if (trimmed.startsWith('TESTS_RUN:')) {
      const value = trimmed.substring('TESTS_RUN:'.length).trim();
      testsRun = parseInt(value, 10) || 0;
    }

    // Match TESTS_PASSED
    if (trimmed.startsWith('TESTS_PASSED:')) {
      const value = trimmed.substring('TESTS_PASSED:'.length).trim();
      testsPassed = parseInt(value, 10) || 0;
    }

    // Match TESTS_FAILED
    if (trimmed.startsWith('TESTS_FAILED:')) {
      const value = trimmed.substring('TESTS_FAILED:'.length).trim();
      testsFailed = parseInt(value, 10) || 0;
    }

    // Match FAILURES section
    if (trimmed === 'FAILURES:') {
      inFailuresSection = true;
      continue;
    }

    // Parse failure lines (in FAILURES section)
    if (inFailuresSection) {
      if (trimmed.startsWith('FIX_ATTEMPTED:') || trimmed.startsWith('TEST_RESULT:') ||
          trimmed.startsWith('NOTES:') || trimmed.startsWith('TESTS_')) {
        inFailuresSection = false;
      } else if (trimmed.startsWith('-')) {
        // Parse failure line: "- file: test name - error message"
        const failureLine = trimmed.substring(1).trim();
        const parts = failureLine.split(':');

        if (parts.length >= 2) {
          const file = parts[0].trim();
          const rest = parts.slice(1).join(':').trim();
          const dashIndex = rest.indexOf(' - ');

          if (dashIndex !== -1) {
            const testName = rest.substring(0, dashIndex).trim();
            const error = rest.substring(dashIndex + 3).trim();
            failures.push({ file, testName, error });
          } else {
            failures.push({ testName: rest, error: '' });
          }
        } else {
          failures.push({ testName: failureLine, error: '' });
        }
      }
    }

    // Match FIX_ATTEMPTED
    if (trimmed.startsWith('FIX_ATTEMPTED:')) {
      const value = trimmed.substring('FIX_ATTEMPTED:'.length).trim();
      fixAttempted = value === 'true';
    }

    // Match FIX_RESULT
    if (trimmed.startsWith('FIX_RESULT:')) {
      const value = trimmed.substring('FIX_RESULT:'.length).trim();
      if (value === 'SUCCESS' || value === 'FAILED' || value === 'NOT_ATTEMPTED') {
        fixResult = value;
      }
    }

    // Match NOTES
    if (trimmed.startsWith('NOTES:')) {
      notes = trimmed.substring('NOTES:'.length).trim();
    }
  }

  // Build result
  if (testResult) {
    return {
      success: testResult === 'PASS',
      testResult,
      testsRun,
      testsPassed,
      testsFailed,
      failures: failures.length > 0 ? failures : undefined,
      fixAttempted,
      fixResult,
      notes,
      output,
      detectedTestCommand,
    };
  } else {
    // No result markers found - assume error
    return {
      success: false,
      testResult: 'ERROR',
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      fixAttempted: false,
      fixResult: 'NOT_ATTEMPTED',
      notes: 'Agent did not report result in expected format',
      output,
    };
  }
}

/**
 * Log test execution to history
 */
function logTestHistory(
  context: TestContext,
  result: TestResult,
  sessionId?: string
): void {
  // Ensure history directory exists
  if (!existsSync(TEST_HISTORY_DIR)) {
    mkdirSync(TEST_HISTORY_DIR, { recursive: true });
  }

  const entry: TestHistoryEntry = {
    timestamp: new Date().toISOString(),
    issueId: context.issueId,
    branch: context.branch,
    projectPath: context.projectPath,
    testCommand: context.testCommand,
    result: {
      ...result,
      output: undefined, // Don't store full output in history
    },
    sessionId,
  };

  appendFileSync(TEST_HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Validate that we have a workspace and main project is on main branch
 *
 * Specialists should ALWAYS run in workspaces, never in the main project.
 * The main project should ALWAYS be on main branch.
 */
async function validateWorkspaceAndBranch(context: TestContext): Promise<{ valid: boolean; error?: string; workingDir: string }> {
  // Workspace is required - specialists should never run without one
  if (!context.workspace) {
    return {
      valid: false,
      error: 'No workspace provided. Test agent requires a workspace to run in.',
      workingDir: context.projectPath,
    };
  }

  // Check workspace exists
  if (!existsSync(context.workspace)) {
    return {
      valid: false,
      error: `Workspace does not exist: ${context.workspace}`,
      workingDir: context.projectPath,
    };
  }

  // Safeguard: Check that main project is on main branch
  // This catches when something has incorrectly checked out a feature branch in the main project
  try {
    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: context.projectPath,
      encoding: 'utf-8',
    });
    const branch = currentBranch.trim();

    if (branch && branch !== 'main' && branch !== 'master') {
      console.warn(`[test-agent] WARNING: Main project at ${context.projectPath} is on branch '${branch}' instead of 'main'`);
      console.warn(`[test-agent] This indicates a bug - the main project should ALWAYS stay on main.`);
      console.warn(`[test-agent] Proceeding with workspace anyway, but this should be investigated.`);
      // Don't fail, just warn - we'll use the workspace which has the correct branch
    }
  } catch (err) {
    // Non-fatal - just log and continue
    console.warn(`[test-agent] Could not check main project branch: ${err}`);
  }

  return {
    valid: true,
    workingDir: context.workspace,
  };
}

/**
 * Spawn test-agent to execute tests
 *
 * @param context - Test context
 * @returns Promise that resolves with test result
 */
export async function spawnTestAgent(context: TestContext): Promise<TestResult> {
  console.log(`[test-agent] Starting test execution for ${context.issueId}`);

  // Validate workspace and branch state
  const validation = await validateWorkspaceAndBranch(context);
  if (!validation.valid) {
    console.error(`[test-agent] ${validation.error}`);
    return {
      success: false,
      testResult: 'ERROR',
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      fixAttempted: false,
      fixResult: 'NOT_ATTEMPTED',
      notes: validation.error,
    };
  }

  const workingDir = validation.workingDir;
  console.log(`[test-agent] Working directory: ${workingDir}`);

  // Detect test command if not provided (use workspace for detection)
  const testCommand = context.testCommand || detectTestCommand(workingDir);

  if (testCommand === 'auto') {
    const result: TestResult = {
      success: false,
      testResult: 'ERROR',
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      fixAttempted: false,
      fixResult: 'NOT_ATTEMPTED',
      notes: 'Could not detect test runner. Please configure test_command in cloister.toml',
    };

    logTestHistory(context, result);
    return result;
  }

  console.log(`[test-agent] Detected test command: ${testCommand}`);

  // Get existing session ID
  const sessionId = getSessionId('test-agent');

  // Build prompt
  const prompt = buildTestPrompt(context);

  // Build Claude command args - Use Haiku for test agent (cheaper, simpler tasks)
  const args = ['--model', 'haiku', '--print', '-p', prompt];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  console.log(`[test-agent] Session: ${sessionId || 'new session'}`);

  // Spawn Claude process in the WORKSPACE (not projectPath!)
  // Workspace has the feature branch checked out; projectPath should stay on main
  const proc = spawn('claude', args, {
    cwd: workingDir,
    env: {
      ...process.env,
      PANOPTICON_AGENT_ID: 'test-agent',
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
  const timeoutPromise = new Promise<TestResult>((_, reject) => {
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('test-agent timeout after 15 minutes'));
    }, TEST_TIMEOUT_MS);
  });

  // Create completion promise
  const completionPromise = new Promise<TestResult>((resolve, reject) => {
    proc.on('close', (code) => {
      console.log(`[test-agent] Process exited with code ${code}`);

      // Try to extract session ID from output if this was a new session
      if (!sessionId && output) {
        // Look for session ID in output (Claude Code prints it)
        const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
        if (sessionMatch) {
          const newSessionId = sessionMatch[1];
          setSessionId('test-agent', newSessionId);
          recordWake('test-agent', newSessionId);
          console.log(`[test-agent] Captured session ID: ${newSessionId}`);
        }
      } else if (sessionId) {
        recordWake('test-agent');
      }

      // Parse output for results
      const result = parseAgentOutput(output);
      result.detectedTestCommand = testCommand;

      // Log to history
      logTestHistory(context, result, sessionId || undefined);

      resolve(result);
    });

    proc.on('error', (error) => {
      console.error(`[test-agent] Process error:`, error);
      reject(error);
    });
  });

  // Race between timeout and completion
  try {
    const result = await Promise.race([completionPromise, timeoutPromise]);
    return result;
  } catch (error: any) {
    console.error(`[test-agent] Failed:`, error);

    const result: TestResult = {
      success: false,
      testResult: 'ERROR',
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      fixAttempted: false,
      fixResult: 'NOT_ATTEMPTED',
      notes: error.message || 'Unknown error',
      output: output || errorOutput,
      detectedTestCommand: testCommand,
    };

    logTestHistory(context, result, sessionId || undefined);

    return result;
  }
}

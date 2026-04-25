/**
 * Merge Validation - Validation utilities for merge completeness
 *
 * Validates that merged code:
 * - Has no conflict markers
 * - Builds successfully
 * - Passes all tests
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import type { QualityGateConfig, TemplatePlaceholders } from '../workspace-config.js';
import { replacePlaceholders } from '../workspace-config.js';
import { loadConfig } from '../config.js';

const execAsync = promisify(exec);

/**
 * Context for validation execution
 */
export interface ValidationContext {
  /** Project root path */
  projectPath: string;
  /** Issue ID for logging */
  issueId?: string;
  /** Custom validation script path (defaults to scripts/validate-merge.sh) */
  validationScript?: string;
  /** Baseline test failure count for comparison mode (pre-existing failures) */
  baselineTestFailures?: number;
}

/**
 * Detailed validation failure information
 */
export interface ValidationFailure {
  /** Type of failure: conflict, build, or test */
  type: 'conflict' | 'build' | 'test';
  /** Files affected (for conflicts) */
  files?: string[];
  /** Error message or output */
  message: string;
}

/**
 * Result of validation execution
 */
export interface ValidationResult {
  /** Overall validation success */
  success: boolean;
  /** Validation passed (or skipped — check `skipped` to distinguish) */
  valid: boolean;
  /** Validation was skipped (no validation script found) */
  skipped?: boolean;
  /** Conflict markers detected */
  conflictMarkersFound: boolean;
  /** Build result */
  buildPassed: boolean | null; // null if not run
  /** Test result */
  testsPassed: boolean | null; // null if not run
  /** List of failures */
  failures: ValidationFailure[];
  /** Raw validation output */
  output: string;
  /** Error message if validation script itself failed */
  error?: string;
}

/**
 * Parse validation script output to extract structured results
 */
function parseValidationOutput(output: string, exitCode: number): ValidationResult {
  const lines = output.split('\n');

  const failures: ValidationFailure[] = [];
  let conflictMarkersFound = false;
  let buildPassed: boolean | null = null;
  let testsPassed: boolean | null = null;

  // Track what stage we're in
  let inConflictCheck = false;
  let inBuildCheck = false;
  let inTestCheck = false;

  const conflictFiles: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect stages
    if (trimmed.startsWith('Checking for conflict markers')) {
      inConflictCheck = true;
      inBuildCheck = false;
      inTestCheck = false;
    } else if (trimmed.startsWith('Running build')) {
      inConflictCheck = false;
      inBuildCheck = true;
      inTestCheck = false;
    } else if (trimmed.startsWith('Running tests')) {
      inConflictCheck = false;
      inBuildCheck = false;
      inTestCheck = true;
    }

    // Parse conflict markers
    if (inConflictCheck) {
      if (trimmed.startsWith('ERROR: Conflict')) {
        conflictMarkersFound = true;
      } else if (trimmed.includes('/') && !trimmed.startsWith('ERROR')) {
        // File path listed
        conflictFiles.push(trimmed);
      } else if (trimmed.startsWith('✓ No conflict markers found')) {
        conflictMarkersFound = false;
      }
    }

    // Parse build result
    if (inBuildCheck) {
      if (trimmed.startsWith('✓ Build passed')) {
        buildPassed = true;
      } else if (trimmed.startsWith('ERROR: Build failed') ||
                 trimmed.includes('VALIDATION FAILED: Build errors detected')) {
        buildPassed = false;
      } else if (trimmed.includes('skipping build check')) {
        buildPassed = null; // Not applicable
      }
    }

    // Parse test result
    if (inTestCheck) {
      if (trimmed.startsWith('✓ Tests passed')) {
        testsPassed = true;
      } else if (trimmed.startsWith('ERROR: Tests failed') ||
                 trimmed.includes('VALIDATION FAILED: Test failures detected')) {
        testsPassed = false;
      } else if (trimmed.includes('skipping test check')) {
        testsPassed = null; // Not applicable
      }
    }
  }

  // Build failures list
  if (conflictMarkersFound) {
    failures.push({
      type: 'conflict',
      files: conflictFiles.length > 0 ? conflictFiles : undefined,
      message: 'Conflict markers detected in merged code',
    });
  }

  if (buildPassed === false) {
    failures.push({
      type: 'build',
      message: 'Build failed after merge',
    });
  }

  if (testsPassed === false) {
    failures.push({
      type: 'test',
      message: 'Tests failed after merge',
    });
  }

  // Determine overall validity
  const valid = exitCode === 0 &&
                !conflictMarkersFound &&
                (buildPassed === null || buildPassed === true) &&
                (testsPassed === null || testsPassed === true);

  return {
    success: true, // Script ran successfully
    valid,
    conflictMarkersFound,
    buildPassed,
    testsPassed,
    failures,
    output,
  };
}

/**
 * Run merge validation on a project
 *
 * @param context - Validation context
 * @returns Promise resolving to validation result
 */
export async function runMergeValidation(
  context: ValidationContext
): Promise<ValidationResult> {
  const { projectPath, validationScript } = context;

  // Determine validation script path
  const scriptPath = validationScript || join(projectPath, 'scripts', 'validate-merge.sh');

  // No validation script = skip validation (specialist already ran build + tests)
  if (!existsSync(scriptPath)) {
    console.log(`[validation] No validation script at ${scriptPath}, skipping (specialist already validated)`);
    return {
      success: true,
      valid: true,
      skipped: true,
      conflictMarkersFound: false,
      buildPassed: null,
      testsPassed: null,
      failures: [],
      output: '',
    };
  }

  console.log(`[validation] Running validation script: ${scriptPath}`);
  console.log(`[validation] Project path: ${projectPath}`);

  try {
    // Run validation script
    // Pass baseline failures as env var for baseline comparison mode
    const env = { ...process.env };
    if (context.baselineTestFailures !== undefined) {
      env.BASELINE_FAILURES = String(context.baselineTestFailures);
      console.log(`[validation] Baseline comparison mode: ${context.baselineTestFailures} pre-existing failures`);
    }

    const { stdout, stderr } = await execAsync(
      `bash "${scriptPath}" "${projectPath}"`,
      {
        cwd: projectPath,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        timeout: 10 * 60 * 1000, // 10 minute timeout
      }
    );

    const output = stdout + stderr;

    console.log(`[validation] ✓ Validation passed`);

    return parseValidationOutput(output, 0);
  } catch (error: any) {
    // Validation script exited with non-zero code (validation failed)
    const exitCode = error.code || 1;
    const output = (error.stdout || '') + (error.stderr || '');

    console.log(`[validation] ✗ Validation failed (exit code ${exitCode})`);

    // Parse the output to understand what failed
    const result = parseValidationOutput(output, exitCode);

    return result;
  }
}

/**
 * Auto-revert a merge if validation fails
 *
 * Uses ORIG_HEAD which git sets automatically at merge time to the commit
 * HEAD pointed to right before the merge. This is always correct regardless
 * of commits added between task start and merge execution.
 *
 * @param projectPath - Project root path
 * @returns Promise resolving to success status
 */
export async function autoRevertMerge(projectPath: string): Promise<boolean> {
  console.log(`[validation] Auto-reverting merge in ${projectPath}`);

  try {
    // Get current commit before revert (for logging)
    const { stdout: beforeCommit } = await execAsync('git rev-parse HEAD', {
      cwd: projectPath,
    });

    // Use ORIG_HEAD — git sets this to pre-merge HEAD at merge time.
    // Handles fast-forwards, multi-commit merges, and any commits
    // added to main between task start and merge execution.
    await execAsync('git reset --hard ORIG_HEAD', {
      cwd: projectPath,
    });

    // Get new HEAD after revert (for logging)
    const { stdout: afterCommit } = await execAsync('git rev-parse HEAD', {
      cwd: projectPath,
    });

    console.log(
      `[validation] ✓ Auto-revert successful: ${beforeCommit.trim()} -> ${afterCommit.trim()} (via ORIG_HEAD)`
    );

    return true;
  } catch (error: any) {
    console.error(`[validation] ✗ Auto-revert failed:`, error.message);
    return false;
  }
}

/**
 * Result of a single quality gate execution
 */
export interface QualityGateResult {
  /** Gate name from projects.yaml */
  name: string;
  /** Whether the gate passed */
  passed: boolean;
  /** Whether the gate was required */
  required: boolean;
  /** Gate output (stdout + stderr) */
  output: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if gate failed */
  error?: string;
}

/**
 * Options for running quality gates
 */
export interface QualityGateRunOptions {
  /** Whether the workspace is remote (SSH) */
  isRemote?: boolean;
  /** VM name for SSH connections (required when isRemote is true) */
  vmName?: string;
  /** Template placeholders for resolving container names (e.g., {{FEATURE_FOLDER}}) */
  placeholders?: TemplatePlaceholders;
}

/**
 * Default quality gates used when no quality_gates config exists in projects.yaml.
 * Runs typecheck → lint sequentially (bail on first failure).
 * Tests are handled by the test specialist with baseline comparison, not verification.
 */
export const DEFAULT_GATES: Record<string, QualityGateConfig> = {
  typecheck: { command: 'npm run typecheck 2>&1' },
  lint: { command: 'npm run lint 2>&1' },
};

/**
 * Run all quality gates for a project
 *
 * Executes each gate in declaration order, stopping on first required failure.
 * Returns results for all gates that were run.
 *
 * Supports both local and remote (SSH) workspaces. For remote workspaces,
 * commands are wrapped with SSH and run on the specified VM.
 *
 * @param gates - Quality gate configs from projects.yaml (or DEFAULT_GATES)
 * @param projectPath - Project root (or workspace root)
 * @param phase - Which phase to run ('pre_push' or 'post_push')
 * @param opts - Optional remote workspace options
 * @returns Array of gate results
 */
export async function runQualityGates(
  gates: Record<string, QualityGateConfig>,
  projectPath: string,
  phase: 'pre_push' | 'post_push' = 'pre_push',
  opts: QualityGateRunOptions = {}
): Promise<QualityGateResult[]> {
  if (opts.isRemote && !opts.vmName) {
    throw new Error('Remote workspace requires vmName');
  }
  if (opts.isRemote && opts.vmName) {
    // Validate vmName and projectPath to prevent shell injection.
    // Both are controlled by Panopticon config, but explicit validation
    // catches any accidental or malicious values before they reach the shell.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.vmName)) {
      throw new Error(`Invalid vmName for SSH: ${opts.vmName}`);
    }
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(projectPath)) {
      throw new Error(`Workspace path contains unsafe characters: ${projectPath}`);
    }
  }
  const results: QualityGateResult[] = [];

  for (const [name, gate] of Object.entries(gates)) {
    const gatePhase = gate.phase || 'pre_push';
    if (gatePhase !== phase) continue;

    const required = gate.required !== false; // default true
    const cwd = gate.path ? join(projectPath, gate.path) : projectPath;

    console.log(`[quality-gate] Running "${name}" (${required ? 'required' : 'optional'}) in ${cwd}`);
    const startTime = Date.now();

    if (gate.type === 'http_health') {
      // HTTP health check gate
      const result = await runHttpHealthGate(name, gate, required);
      results.push(result);
      if (!result.passed && required) {
        console.log(`[quality-gate] ✗ Required gate "${name}" failed — stopping`);
        break;
      }
      continue;
    }

    // Command gate (default)

    // For remote workspaces, build and validate the SSH command BEFORE entering
    // the try/catch so validation errors propagate as real errors (not gate failures).
    const isRemote = opts.isRemote && opts.vmName;
    let resolvedCommand: string;
    if (isRemote) {
      // Validate cwd (which may include gate.path) — not just the base projectPath.
      // A gate.path like "frontend;rm -rf /" would produce an unsafe cwd after join.
      if (!/^[a-zA-Z0-9/_\-.]+$/.test(cwd)) {
        throw new Error(`Gate "${name}" path resolves to unsafe characters for SSH: ${cwd}`);
      }
      // Validate gate.command doesn't contain double quotes — a " in the command would
      // end the SSH double-quoted string and allow local command injection:
      //   ssh host "cd /path && legit; injected"  ← breaks when command contains "
      if (gate.command.includes('"')) {
        throw new Error(`Gate "${name}" command contains double quotes which are unsafe in SSH context`);
      }
      const flyAppName = loadConfig().remote?.fly?.app ?? 'pan-workspaces';
      resolvedCommand = `fly ssh console -a ${flyAppName} -C "cd ${cwd} && ${gate.command}"`;
    } else if (gate.container && gate.container_name) {
      // Run inside Docker container — resolve container name from placeholders
      let containerName = gate.container_name;
      if (opts.placeholders) {
        containerName = replacePlaceholders(containerName, opts.placeholders);
      }
      // Use -w to set working directory inside the container.
      // The container mounts workspace code at /workspaces/feature/<subdir>,
      // so map the gate.path (e.g., 'fe') to the container's working directory.
      const containerWorkdir = gate.path ? `/workspaces/feature/${gate.path}` : '/workspaces/feature';
      // Pass gate.env as -e flags so env vars reach the container process
      const envFlags = gate.env
        ? Object.entries(gate.env).map(([k, v]) => `-e ${k}="${v}"`).join(' ')
        : '';
      resolvedCommand = `docker exec ${envFlags} -w "${containerWorkdir}" "${containerName}" ${gate.command}`;
      console.log(`[quality-gate] Running in container: ${containerName} (workdir: ${containerWorkdir})`);
    } else {
      resolvedCommand = gate.command;
    }

    try {
      // When running in container, don't set host cwd (irrelevant)
      const useHostCwd = !isRemote && !(gate.container && gate.container_name);
      const env = { ...process.env, ...gate.env };
      const { stdout, stderr } = await execAsync(resolvedCommand, {
        cwd: useHostCwd ? cwd : undefined,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 5 * 60 * 1000, // 5 minute timeout per gate
      });

      const durationMs = Date.now() - startTime;
      console.log(`[quality-gate] ✓ "${name}" passed (${durationMs}ms)`);
      results.push({
        name,
        passed: true,
        required,
        output: (stdout + stderr).slice(-2000), // keep last 2KB
        durationMs,
      });
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const output = ((error.stdout || '') + (error.stderr || '')).slice(-2000);
      console.log(`[quality-gate] ✗ "${name}" failed (${durationMs}ms): ${error.message?.slice(0, 200)}`);
      results.push({
        name,
        passed: false,
        required,
        output,
        durationMs,
        error: error.message?.slice(0, 500),
      });

      if (required) {
        console.log(`[quality-gate] ✗ Required gate "${name}" failed — stopping`);
        break;
      }
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`[quality-gate] Complete: ${passed} passed, ${failed} failed out of ${results.length} gates`);

  return results;
}

/**
 * Run an HTTP health check gate (for post-push deployment verification)
 */
async function runHttpHealthGate(
  name: string,
  gate: QualityGateConfig,
  required: boolean
): Promise<QualityGateResult> {
  const url = gate.url;
  if (!url) {
    return {
      name,
      passed: false,
      required,
      output: '',
      durationMs: 0,
      error: 'http_health gate missing url',
    };
  }

  const waitSeconds = gate.wait || 120;
  const expectStatus = gate.expect_status || 200;
  const startTime = Date.now();

  console.log(`[quality-gate] Waiting ${waitSeconds}s for deployment, then checking ${url}`);

  // Wait for deployment
  await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

  try {
    const { stdout } = await execAsync(
      `curl -sL -o /dev/null -w '%{http_code}' --max-time 30 '${url}'`,
      { timeout: 60 * 1000 }
    );

    const statusCode = parseInt(stdout.trim(), 10);
    const passed = statusCode === expectStatus;
    const durationMs = Date.now() - startTime;

    console.log(`[quality-gate] Health check ${url}: ${statusCode} (expected ${expectStatus}) — ${passed ? 'PASS' : 'FAIL'}`);

    return {
      name,
      passed,
      required,
      output: `HTTP ${statusCode} from ${url}`,
      durationMs,
      error: passed ? undefined : `Expected HTTP ${expectStatus}, got ${statusCode}`,
    };
  } catch (error: any) {
    return {
      name,
      passed: false,
      required,
      output: error.message || '',
      durationMs: Date.now() - startTime,
      error: `Health check failed: ${error.message?.slice(0, 200)}`,
    };
  }
}

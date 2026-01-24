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
  /** Validation passed */
  valid: boolean;
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

  // Check if validation script exists
  if (!existsSync(scriptPath)) {
    return {
      success: false,
      valid: false,
      conflictMarkersFound: false,
      buildPassed: null,
      testsPassed: null,
      failures: [],
      output: '',
      error: `Validation script not found at ${scriptPath}`,
    };
  }

  console.log(`[validation] Running validation script: ${scriptPath}`);
  console.log(`[validation] Project path: ${projectPath}`);

  try {
    // Run validation script
    const { stdout, stderr } = await execAsync(
      `bash "${scriptPath}" "${projectPath}"`,
      {
        cwd: projectPath,
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
 * Reverts the most recent commit (assumed to be the merge commit)
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

    // Revert the merge
    await execAsync('git reset --hard HEAD~1', {
      cwd: projectPath,
    });

    // Get new HEAD after revert (for logging)
    const { stdout: afterCommit } = await execAsync('git rev-parse HEAD', {
      cwd: projectPath,
    });

    console.log(
      `[validation] ✓ Auto-revert successful: ${beforeCommit.trim()} -> ${afterCommit.trim()}`
    );

    return true;
  } catch (error: any) {
    console.error(`[validation] ✗ Auto-revert failed:`, error.message);
    return false;
  }
}

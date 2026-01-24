/**
 * Test Runner
 *
 * Generic test runner that supports various test frameworks
 * and can run tests inside or outside Docker containers.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { ProjectConfig, TestConfig, TemplatePlaceholders, replacePlaceholders } from './workspace-config.js';

const execAsync = promisify(exec);

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  passed: number;
  failed: number;
  duration: string;
  exitCode: number;
  logFile: string;
}

export interface TestRunResult {
  target: string;
  baseUrl: string;
  timestamp: string;
  tests: TestResult[];
  overallStatus: 'passed' | 'failed';
  totalFailures: number;
  reportFile: string;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Parse test output for pass/fail counts
 */
function parseTestOutput(output: string, type: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  switch (type) {
    case 'maven':
      // Parse: Tests run: X, Failures: Y, Errors: Z
      const testsMatch = output.match(/Tests run: (\d+)/);
      const failuresMatch = output.match(/Failures: (\d+)/);
      const errorsMatch = output.match(/Errors: (\d+)/);
      passed = testsMatch ? parseInt(testsMatch[1], 10) : 0;
      failed = (failuresMatch ? parseInt(failuresMatch[1], 10) : 0) +
               (errorsMatch ? parseInt(errorsMatch[1], 10) : 0);
      passed = Math.max(0, passed - failed);
      break;

    case 'vitest':
    case 'jest':
      // Parse: X passed, Y failed
      const passedMatch = output.match(/(\d+) passed/);
      const failedMatch = output.match(/(\d+) failed/);
      passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
      failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
      break;

    case 'playwright':
      // Parse: X passed, Y failed
      const pwPassedMatch = output.match(/(\d+) passed/);
      const pwFailedMatch = output.match(/(\d+) failed/);
      passed = pwPassedMatch ? parseInt(pwPassedMatch[1], 10) : 0;
      failed = pwFailedMatch ? parseInt(pwFailedMatch[1], 10) : 0;
      break;

    case 'pytest':
      // Parse: X passed, Y failed
      const pyPassedMatch = output.match(/(\d+) passed/);
      const pyFailedMatch = output.match(/(\d+) failed/);
      passed = pyPassedMatch ? parseInt(pyPassedMatch[1], 10) : 0;
      failed = pyFailedMatch ? parseInt(pyFailedMatch[1], 10) : 0;
      break;

    case 'cargo':
      // Parse: test result: ok. X passed; Y failed
      const cargoPassedMatch = output.match(/(\d+) passed/);
      const cargoFailedMatch = output.match(/(\d+) failed/);
      passed = cargoPassedMatch ? parseInt(cargoPassedMatch[1], 10) : 0;
      failed = cargoFailedMatch ? parseInt(cargoFailedMatch[1], 10) : 0;
      break;
  }

  return { passed, failed };
}

/**
 * Run a single test suite
 */
async function runTestSuite(
  testName: string,
  testConfig: TestConfig,
  workspacePath: string,
  placeholders: TemplatePlaceholders,
  reportsDir: string,
  timestamp: string
): Promise<TestResult> {
  const testPath = join(workspacePath, testConfig.path);
  const logFile = join(reportsDir, `${testName}-${timestamp}.log`);

  const result: TestResult = {
    name: testName,
    status: 'pending',
    passed: 0,
    failed: 0,
    duration: '--',
    exitCode: 0,
    logFile,
  };

  // Build command with environment variables
  let command = testConfig.command;
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  if (testConfig.env) {
    for (const [key, value] of Object.entries(testConfig.env)) {
      env[key] = replacePlaceholders(value, placeholders);
    }
  }

  // If running in container, wrap command
  if (testConfig.container && testConfig.container_name) {
    const containerName = replacePlaceholders(testConfig.container_name, placeholders);
    command = `docker exec "${containerName}" ${command}`;
  }

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: testPath,
      env,
      timeout: 600000, // 10 minute timeout
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    const output = stdout + '\n' + stderr;
    writeFileSync(logFile, output);

    const { passed, failed } = parseTestOutput(output, testConfig.type);
    result.passed = passed;
    result.failed = failed;
    result.status = 'passed';
    result.exitCode = 0;
  } catch (error: any) {
    const output = (error.stdout || '') + '\n' + (error.stderr || '');
    writeFileSync(logFile, output);

    const { passed, failed } = parseTestOutput(output, testConfig.type);
    result.passed = passed;
    result.failed = failed;
    result.status = 'failed';
    result.exitCode = error.code || 1;
  }

  const endTime = Date.now();
  result.duration = formatDuration(Math.floor((endTime - startTime) / 1000));

  return result;
}

/**
 * Generate markdown report
 */
function generateReport(result: TestRunResult): string {
  const lines: string[] = [
    `# Test Run Report - ${result.target}`,
    '',
    `**Date:** ${result.timestamp}`,
    `**Target:** ${result.target}`,
    `**Base URL:** ${result.baseUrl}`,
    '',
    '## Summary',
    '',
    '| Suite | Status | Passed | Failed | Duration |',
    '|-------|--------|--------|--------|----------|',
  ];

  for (const test of result.tests) {
    const statusEmoji = test.status === 'passed' ? '✅ PASS' :
                        test.status === 'failed' ? '❌ FAIL' :
                        test.status === 'skipped' ? '⏭️ SKIP' : '⏳ PENDING';
    lines.push(`| ${test.name} | ${statusEmoji} | ${test.passed} | ${test.failed} | ${test.duration} |`);
  }

  const overallEmoji = result.overallStatus === 'passed' ? '✅ ALL PASSED' : '❌ FAILED';
  lines.push('');
  lines.push(`**Overall: ${overallEmoji}** (${result.totalFailures} failures)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Add details for each test
  for (const test of result.tests) {
    const statusEmoji = test.status === 'passed' ? '✅ PASS' : '❌ FAIL';
    lines.push(`## ${test.name}`);
    lines.push('');
    lines.push(`- **Status:** ${statusEmoji}`);
    lines.push(`- **Duration:** ${test.duration}`);
    lines.push(`- **Exit code:** ${test.exitCode}`);
    lines.push(`- **Log:** \`${test.logFile}\``);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Generated by pan test on ${result.timestamp}*`);

  return lines.join('\n');
}

/**
 * Send notification about test results
 */
async function sendNotification(result: TestRunResult): Promise<void> {
  const title = `Tests (${result.target}): ${result.overallStatus === 'passed' ? '✅ All Passed' : '❌ Failed'}`;
  const message = result.overallStatus === 'passed'
    ? 'All test suites passed'
    : `${result.totalFailures} suite(s) failed. Check report: ${result.reportFile}`;

  // Try to use notify-complete if available
  const notifyScript = join(homedir(), '.panopticon', 'bin', 'notify-complete');
  if (existsSync(notifyScript)) {
    try {
      await execAsync(`"${notifyScript}" "${result.target}" "${message}"`);
    } catch {
      // Notification failed, ignore
    }
  }
}

export interface RunTestsOptions {
  projectConfig: ProjectConfig;
  featureName?: string;
  testNames?: string[];
  notify?: boolean;
}

/**
 * Run all tests for a project/workspace
 */
export async function runTests(options: RunTestsOptions): Promise<TestRunResult> {
  const { projectConfig, featureName, testNames, notify = true } = options;

  const workspaceConfig = projectConfig.workspace;
  const testsConfig = projectConfig.tests;

  if (!testsConfig || Object.keys(testsConfig).length === 0) {
    throw new Error('No tests configured for this project');
  }

  // Determine workspace path
  let workspacePath: string;
  let target: string;
  let baseUrl: string;

  if (featureName) {
    const workspacesDir = join(projectConfig.path, workspaceConfig?.workspaces_dir || 'workspaces');
    const featureFolder = `feature-${featureName}`;
    workspacePath = join(workspacesDir, featureFolder);
    target = featureFolder;
    baseUrl = workspaceConfig?.dns?.domain
      ? `https://${featureFolder}.${workspaceConfig.dns.domain}`
      : `http://localhost:3000`;

    if (!existsSync(workspacePath)) {
      throw new Error(`Workspace not found: ${workspacePath}`);
    }
  } else {
    workspacePath = projectConfig.path;
    target = 'main';
    baseUrl = workspaceConfig?.dns?.domain
      ? `https://${workspaceConfig.dns.domain}`
      : 'http://localhost:3000';
  }

  // Create placeholders
  const featureFolder = featureName ? `feature-${featureName}` : 'main';
  const placeholders: TemplatePlaceholders = {
    FEATURE_NAME: featureName || 'main',
    FEATURE_FOLDER: featureFolder,
    BRANCH_NAME: featureName ? `feature/${featureName}` : 'main',
    COMPOSE_PROJECT: `${basename(projectConfig.path)}-${featureFolder}`,
    DOMAIN: workspaceConfig?.dns?.domain || 'localhost',
    PROJECT_NAME: basename(projectConfig.path),
    PROJECT_PATH: projectConfig.path,
    WORKSPACE_PATH: workspacePath,
  };

  // Set up reports directory
  const reportsDir = join(projectConfig.path, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportFile = join(reportsDir, `test-run-${target}-${timestamp}.md`);

  const result: TestRunResult = {
    target,
    baseUrl,
    timestamp: new Date().toISOString(),
    tests: [],
    overallStatus: 'passed',
    totalFailures: 0,
    reportFile,
  };

  console.log('==============================================');
  console.log(`Test Runner - ${new Date().toISOString()}`);
  console.log('==============================================');
  console.log('');
  console.log(`Target: ${target}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Report: ${reportFile}`);
  console.log('');

  // Determine which tests to run
  const testsToRun = testNames
    ? Object.entries(testsConfig).filter(([name]) => testNames.includes(name))
    : Object.entries(testsConfig);

  // Run each test suite
  for (const [testName, testConfig] of testsToRun) {
    console.log(`>>> Running ${testName}...`);

    const testResult = await runTestSuite(
      testName,
      testConfig,
      workspacePath,
      placeholders,
      reportsDir,
      timestamp
    );

    result.tests.push(testResult);

    if (testResult.status === 'failed') {
      result.totalFailures++;
    }

    const statusEmoji = testResult.status === 'passed' ? '✅' : '❌';
    console.log(`${testName}: ${statusEmoji} ${testResult.status.toUpperCase()} (${testResult.duration})`);
    console.log('');
  }

  // Determine overall status
  result.overallStatus = result.totalFailures === 0 ? 'passed' : 'failed';

  // Generate and save report
  const report = generateReport(result);
  writeFileSync(reportFile, report);

  console.log('==============================================');
  console.log(`COMPLETE: ${result.overallStatus === 'passed' ? '✅ ALL PASSED' : '❌ FAILED'}`);
  console.log('==============================================');
  console.log('');
  console.log(`Report: ${reportFile}`);
  console.log('');

  // Send notification
  if (notify) {
    await sendNotification(result);
  }

  return result;
}

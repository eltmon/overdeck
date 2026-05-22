/**
 * Specialist Log Viewing Commands
 *
 * pan specialists logs <project> <type> - list recent runs
 * pan specialists logs <project> <type> <runId> - view specific run
 * pan specialists logs --tail <project> <type> - follow active run
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface LogsOptions {
  json?: boolean;
  limit?: string;
  tail?: boolean;
}

/**
 * List recent runs for a project's specialist
 */
export async function listLogsCommand(
  project: string,
  type: string,
  options: LogsOptions
): Promise<void> {
  try {
    const { listRunLogsSync } = await import('../../../lib/cloister/specialist-logs.js');

    const limit = options.limit ? parseInt(options.limit) : 10;
    const runs = listRunLogsSync(project, type, { limit });

    if (options.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }

    if (runs.length === 0) {
      console.log(`No runs found for ${project}/${type}`);
      return;
    }

    console.log(`\n📊 Recent runs for ${project}/${type}:\n`);

    runs.forEach((run, index) => {
      const statusEmoji = {
        passed: '✅',
        failed: '❌',
        blocked: '⚠️',
        incomplete: '🔄',
      }[run.metadata.status || 'incomplete'] || '❓';

      const duration = run.metadata.duration
        ? `${Math.floor(run.metadata.duration / 60000)}m ${Math.floor((run.metadata.duration % 60000) / 1000)}s`
        : '-';

      const date = new Date(run.metadata.startedAt);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

      console.log(
        `${index + 1}. ${statusEmoji} ${run.metadata.issueId} (${run.metadata.status || 'incomplete'})`
      );
      console.log(`   Run ID: ${run.runId}`);
      console.log(`   Started: ${dateStr}`);
      console.log(`   Duration: ${duration}`);
      if (run.metadata.notes) {
        console.log(`   Notes: ${run.metadata.notes}`);
      }
      console.log('');
    });

    console.log(`\nView a specific run: pan specialists logs ${project} ${type} <runId>\n`);
  } catch (error: any) {
    console.error('❌ Error listing logs:', error.message);
    process.exit(1);
  }
}

/**
 * View a specific run log
 */
export async function viewLogCommand(
  project: string,
  type: string,
  runId: string,
  options: LogsOptions
): Promise<void> {
  try {
    const { getRunLogSync, parseLogMetadata, getRunLogPath } = await import('../../../lib/cloister/specialist-logs.js');

    const content = getRunLogSync(project, type, runId);

    if (!content) {
      console.error(`❌ Run log not found: ${runId}`);
      process.exit(1);
    }

    if (options.json) {
      const metadata = parseLogMetadata(content);
      console.log(JSON.stringify({ runId, content, metadata }, null, 2));
      return;
    }

    // Use 'less' for viewing if available, otherwise print directly
    const logPath = getRunLogPath(project, type, runId);

    try {
      // Try to use less for better viewing experience
      await execAsync(`less -R "${logPath}"`);
    } catch {
      // Fall back to printing directly
      console.log(content);
    }
  } catch (error: any) {
    console.error('❌ Error viewing log:', error.message);
    process.exit(1);
  }
}

/**
 * Tail an active run log (follow mode)
 */
export async function tailLogCommand(project: string, type: string): Promise<void> {
  try {
    const { getRunLogPath } = await import('../../../lib/cloister/specialist-logs.js');

    // Get current run ID
    const { getProjectSpecialistMetadata } = await import('../../../lib/cloister/specialists.js');
    const metadata = getProjectSpecialistMetadata(project, type as any);

    if (!metadata.currentRun) {
      console.error(`❌ No active run for ${project}/${type}`);
      process.exit(1);
    }

    const logPath = getRunLogPath(project, type, metadata.currentRun);

    if (!existsSync(logPath)) {
      console.error(`❌ Log file not found: ${logPath}`);
      process.exit(1);
    }

    console.log(`📡 Following ${project}/${type} (${metadata.currentRun})...`);
    console.log(`   Press Ctrl+C to stop\n`);

    // Use tail -f to follow the log
    const { spawn } = await import('child_process');
    const tail = spawn('tail', ['-f', logPath], {
      stdio: 'inherit',
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n\n📊 Stopped following log');
      tail.kill();
      process.exit(0);
    });

    // Wait for tail to exit
    await new Promise<void>((resolve, reject) => {
      tail.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tail exited with code ${code}`));
        }
      });
      tail.on('error', reject);
    });
  } catch (error: any) {
    console.error('❌ Error tailing log:', error.message);
    process.exit(1);
  }
}

/**
 * Main logs command handler
 */
export async function logsCommand(
  projectOrOptions: string | LogsOptions,
  type?: string,
  runIdOrOptions?: string | LogsOptions,
  maybeOptions?: LogsOptions
): Promise<void> {
  // Handle --tail mode: pan specialists logs --tail <project> <type>
  if (typeof projectOrOptions === 'object' && projectOrOptions.tail) {
    if (!type || !runIdOrOptions || typeof runIdOrOptions === 'object') {
      console.error('❌ Usage: pan specialists logs --tail <project> <type>');
      process.exit(1);
    }
    await tailLogCommand(type, runIdOrOptions as string);
    return;
  }

  const project = projectOrOptions as string;

  // Handle list mode: pan specialists logs <project> <type>
  if (!runIdOrOptions || typeof runIdOrOptions === 'object') {
    const options = (runIdOrOptions as LogsOptions) || {};
    if (!type) {
      console.error('❌ Usage: pan specialists logs <project> <type>');
      process.exit(1);
    }
    await listLogsCommand(project, type, options);
    return;
  }

  // Handle view mode: pan specialists logs <project> <type> <runId>
  const runId = runIdOrOptions as string;
  const options = maybeOptions || {};
  await viewLogCommand(project, type!, runId, options);
}

/**
 * Clean up old logs command
 */
export async function cleanupLogsCommand(
  projectOrAll?: string,
  type?: string,
  options?: { force?: boolean }
): Promise<void> {
  try {
    // Handle cleanup-all: pan specialists cleanup-logs --all
    if (projectOrAll === '--all' || (options as any)?.all) {
      if (!(options as any)?.force) {
        console.log('⚠️  This will clean up old logs for all projects and specialists.');
        console.log('   Use --force to confirm.');
        process.exit(1);
      }

      const { cleanupAllLogsSync } = await import('../../../lib/cloister/specialist-logs.js');
      console.log('🧹 Cleaning up old logs for all projects...\n');

      const results = cleanupAllLogsSync();

      console.log(`\n✅ Cleanup complete: deleted ${results.totalDeleted} old logs\n`);

      if (results.totalDeleted > 0) {
        console.log('By project:');
        for (const [projectKey, specialists] of Object.entries(results.byProject)) {
          for (const [specialistType, count] of Object.entries(specialists)) {
            console.log(`  - ${projectKey}/${specialistType}: ${count} logs`);
          }
        }
        console.log('');
      }

      return;
    }

    // Handle single project cleanup: pan specialists cleanup-logs <project> <type>
    if (!projectOrAll || !type) {
      console.error('❌ Usage: pan specialists cleanup-logs <project> <type>');
      console.error('   or:    pan specialists cleanup-logs --all --force');
      process.exit(1);
    }

    if (!options?.force) {
      console.log(`⚠️  This will clean up old logs for ${projectOrAll}/${type}.`);
      console.log('   Use --force to confirm.');
      process.exit(1);
    }

    const { cleanupOldLogsSync } = await import('../../../lib/cloister/specialist-logs.js');
    const { getSpecialistRetention } = await import('../../../lib/projects.js');

    const retention = getSpecialistRetention(projectOrAll);
    console.log(`🧹 Cleaning up old logs for ${projectOrAll}/${type}...`);
    console.log(`   Retention: ${retention.max_days} days or ${retention.max_runs} runs\n`);

    const deleted = cleanupOldLogsSync(projectOrAll, type, { maxDays: retention.max_days, maxRuns: retention.max_runs });

    console.log(`✅ Deleted ${deleted} old logs\n`);
  } catch (error: any) {
    console.error('❌ Error cleaning up logs:', error.message);
    process.exit(1);
  }
}

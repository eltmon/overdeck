/** Composer reloads outlive the dashboard they restart. The CLI owns progress. */
import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComposerCommandResult } from '@overdeck/contracts';
import { emitActivityEntryOncePortable } from '../activity-logger.js';
import { getDashboardLoopbackApiUrlSync } from '../config.js';
import { spawnPanCli } from '../pan-cli-invocation.js';
import { getOverdeckHome } from '../paths.js';

interface ReloadDependencies {
  spawnPanCli?: typeof spawnPanCli;
  overdeckHome?: string;
}

export async function runComposerReload(
  argv: readonly string[],
  dependencies: ReloadDependencies = {},
): Promise<ComposerCommandResult> {
  const activityId = `composer-reload-${randomUUID()}`;
  const logDir = join(dependencies.overdeckHome ?? getOverdeckHome(), 'logs');
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${activityId}.log`);
  const log = await open(logPath, 'a', 0o600);
  const env = { ...process.env };
  // This is a direct operator command, independent of the selected conversation.
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_ISSUE_ID;
  delete env.DASHBOARD_URL;
  env.OVERDECK_DASHBOARD_URL = getDashboardLoopbackApiUrlSync();
  env.OVERDECK_RESTART_INITIATOR = 'operator:composer';
  env.OVERDECK_COMPOSER_RELOAD_ACTIVITY = activityId;
  env.OVERDECK_COMPOSER_RELOAD_LOG = logPath;
  const args = [...argv];
  if (!args.some(arg => arg === '--health-timeout' || arg.startsWith('--health-timeout='))) {
    args.push('--health-timeout', '120s');
  }
  try {
    const child = (dependencies.spawnPanCli ?? spawnPanCli)(args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env,
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } catch (error) {
    return {
      kind: 'captured', status: 'failed', command: `/pan ${argv.join(' ')}`,
      output: `Reload could not start: ${error instanceof Error ? error.message : String(error)}`,
      truncated: false,
    };
  } finally {
    // The detached child has its own descriptor; parent shutdown cannot close it.
    await log.close();
  }
  return {
    kind: 'activity', status: 'accepted', command: `/pan ${argv.join(' ')}`, activityId,
    message: 'Reload started. Watch the Activity feed for build progress. When the build is ready, use the restart banner to put it live.',
  };
}

type ReloadPhase = 'building' | 'awaiting-approval' | 'restarting' | 'completed' | 'failed';
const PHASE_MESSAGES: Record<ReloadPhase, string> = {
  building: 'Reload started: preparing the dashboard build.',
  'awaiting-approval': 'The dashboard build is ready. Use the restart banner to put it live.',
  restarting: 'Restart approved. The dashboard is restarting; conversations and terminals will reconnect.',
  completed: 'Reload completed successfully.',
  failed: 'Reload failed. Check the activity details for the command output.',
};

/** Runs in the detached CLI, so completion still arrives after server restart. */
export async function reportComposerReloadProgress(
  phase: ReloadPhase,
  activityId?: string,
  logPath?: string,
): Promise<void> {
  // Activity is supplementary; a reporting failure must never abort a reload.
  await reportProgress(phase, activityId, logPath).catch(() => undefined);
}

async function reportProgress(phase: ReloadPhase, activityId?: string, logPath?: string): Promise<void> {
  if (!activityId) return;
  let output: string | undefined;
  if (logPath && (phase === 'failed' || phase === 'completed')) {
    const handle = await open(logPath, 'r').catch(() => undefined);
    if (handle) {
      try {
        const { size } = await handle.stat();
        const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        output = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    }
  }
  // Each phase is a durable, idempotent entry, including across dashboard boots.
  await emitActivityEntryOncePortable({
    id: `${activityId}:${phase}`, source: 'dashboard', command: '/pan reload',
    status: phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : 'running',
    level: phase === 'failed' ? 'error' : phase === 'completed' ? 'success' : 'info',
    message: PHASE_MESSAGES[phase], output, details: output,
  });
}

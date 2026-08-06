/**
 * pan admin seed-uat-fixtures (PAN-3362, WI-3).
 *
 * Host mode resolves an issue's workspace container stack, runs the local
 * seeder inside its `server` container, restarts the server so skip-polling
 * mode picks up the seeded cache/DB rows, then waits for the health endpoint.
 * `--local` (run by the host wrapper, or manually inside a container) calls
 * seedUatFixturesLocal() directly.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from 'commander';

import { exitCli } from '../../exit.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { requireComposeProjectNameForWorkspace } from '../../../lib/workspace/stack-health.js';

const execFileAsync = promisify(execFile);

// Mirrors the standard-name search order docker compose itself auto-discovers
// (src/lib/workspace/rebuild-stack.ts's COMPOSE_FILES) — duplicated locally
// rather than imported since it is not exported there.
const COMPOSE_FILE_CANDIDATES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

function findComposeFile(workspacePath: string): string | null {
  const devcontainerDir = join(workspacePath, '.devcontainer');
  for (const name of COMPOSE_FILE_CANDIDATES) {
    const full = join(devcontainerDir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function resolveWorkspacePath(issueId: string): string {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  if (!resolvedProject || !projectConfig) {
    throw new Error(`No project found for issue ${issueId}`);
  }
  return join(
    resolvedProject.projectPath,
    projectConfig.workspace?.workspaces_dir ?? 'workspaces',
    `feature-${issueId.toLowerCase()}`,
  );
}

async function pollHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
      lastError = new Error(`health endpoint returned HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url} to become healthy: ${reason}`);
}

async function seedUatFixturesHost(issueId: string): Promise<void> {
  const normalized = issueId.toLowerCase();
  const workspacePath = resolveWorkspacePath(issueId);
  if (!existsSync(workspacePath)) {
    throw new Error(
      `Workspace not found for ${issueId}: ${workspacePath}. Start it first with \`pan start ${issueId}\`.`,
    );
  }
  const composeFile = findComposeFile(workspacePath);
  if (!composeFile) {
    throw new Error(
      `No devcontainer compose file found for ${issueId} under ${join(workspacePath, '.devcontainer')}.`,
    );
  }
  const composeProjectName = requireComposeProjectNameForWorkspace(workspacePath, issueId);
  const cwd = dirname(composeFile);

  const running = await execFileAsync(
    'docker',
    ['compose', '-f', composeFile, '-p', composeProjectName, 'ps', '-q', 'server'],
    { cwd },
  ).catch(() => ({ stdout: '' }));
  if (!running.stdout.trim()) {
    throw new Error(
      `No running compose stack for ${issueId} (expected compose project ${composeProjectName}). ` +
      `Start it with \`pan workspace rebuild ${issueId}\` or \`pan start ${issueId}\` first.`,
    );
  }

  console.log(`Seeding UAT fixtures inside ${composeProjectName}...`);
  const seedResult = await execFileAsync(
    'docker',
    ['compose', '-f', composeFile, '-p', composeProjectName, 'exec', '-T', 'server',
      'node', 'dist/cli/index.js', 'admin', 'seed-uat-fixtures', '--local'],
    { cwd },
  );
  if (seedResult.stdout.trim()) console.log(seedResult.stdout.trim());

  console.log('Restarting the server so it picks up the seeded fixtures...');
  await execFileAsync('docker', ['compose', '-f', composeFile, '-p', composeProjectName, 'restart', 'server'], { cwd });

  const healthUrl = `https://api-feature-${normalized}.overdeck.localhost/api/health`;
  console.log(`Waiting for ${healthUrl} to become healthy...`);
  await pollHealth(healthUrl);

  const dashboardUrl = `https://feature-${normalized}.overdeck.localhost`;
  console.log(`Seeded FIX-1. Open ${dashboardUrl} to verify.`);
}

export function registerSeedUatFixturesCommand(admin: Command): void {
  admin
    .command('seed-uat-fixtures [issue-id]')
    .description(
      'Seed the obviously-fake FIX-1 issue fixture into a workspace container for UI UAT. ' +
      'Host mode: `pan admin seed-uat-fixtures <issue-id>` seeds and restarts that issue\'s ' +
      'workspace container from the host. `--local` runs the seed itself against the current ' +
      'OVERDECK_HOME — used by the host wrapper, or manually inside a container.',
    )
    .option('--local', 'Seed the current (container-local) OVERDECK_HOME directly, without a host wrapper step')
    .action(async (issueId: string | undefined, options: { local?: boolean }) => {
      try {
        if (options.local) {
          const { seedUatFixturesLocal } = await import('../../../lib/uat-fixtures/seed.js');
          const report = await seedUatFixturesLocal();
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        if (!issueId) {
          console.error('Usage: pan admin seed-uat-fixtures <issue-id>  (or: pan admin seed-uat-fixtures --local)');
          return exitCli(1);
        }
        await seedUatFixturesHost(issueId);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return exitCli(1);
      }
    });
}

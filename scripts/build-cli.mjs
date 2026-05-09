import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const distDir = join(projectRoot, 'dist');
const dashboardDir = join(distDir, 'dashboard');
const promptsDir = join(distDir, 'prompts');
const cliPromptsDir = join(distDir, 'cli', 'prompts');
const preservedRoot = join(tmpdir(), `panopticon-dashboard-${process.pid}-${Date.now()}`);
const preservedDashboardDir = join(preservedRoot, 'dashboard');

const restoreDashboard = () => {
  if (!existsSync(preservedDashboardDir)) {
    return;
  }

  mkdirSync(distDir, { recursive: true });
  if (existsSync(dashboardDir)) {
    rmSync(dashboardDir, { recursive: true, force: true });
  }
  renameSync(preservedDashboardDir, dashboardDir);
};

try {
  if (existsSync(dashboardDir)) {
    mkdirSync(preservedRoot, { recursive: true });
    renameSync(dashboardDir, preservedDashboardDir);
  }

  const build = spawnSync('tsdown', { cwd: projectRoot, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    restoreDashboard();
    process.exit(build.status ?? 1);
  }

  restoreDashboard();

  mkdirSync(promptsDir, { recursive: true });
  mkdirSync(cliPromptsDir, { recursive: true });
  const copyPrompts = spawnSync(
    'sh',
    ['-lc', 'cp src/lib/cloister/prompts/*.md dist/prompts/ && cp src/lib/cloister/prompts/*.md dist/cli/prompts/'],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  if (copyPrompts.status !== 0) {
    process.exit(copyPrompts.status ?? 1);
  }
} finally {
  rmSync(preservedRoot, { recursive: true, force: true });
}

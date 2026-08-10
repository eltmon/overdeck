import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';
import { ensureStateWorktree, inspectLegacyStatePaths, type StateWorktreeStatus } from '../../lib/state-home.js';

interface StateWorktreeCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function checkStateWorktrees(
  projects: Array<{ key: string; config: ProjectConfig }> = listProjectsSync(),
  ensure: (project: ProjectConfig, options: { projectKey: string }) => Promise<StateWorktreeStatus> = ensureStateWorktree,
): Promise<StateWorktreeCheck[]> {
  return Promise.all(projects.map(async ({ key, config }) => {
    try {
      const result = await ensure(config, { projectKey: key });
      const name = `State Worktree: ${key} (${config.name})`;
      const legacy = await inspectLegacyStatePaths(config);
      if (legacy.postMigrationWrites.length > 0) {
        return {
          name,
          status: 'error',
          message: `Migrated checkout contains post-migration legacy state writes: ${legacy.postMigrationWrites.join(', ')}`,
          fix: 'Stop the stray writer and move the data through the state write door; do not delete before comparing it with overdeck-state.',
        };
      }
      if (legacy.inertDirectories.length > 0 || legacy.staleFiles.length > 0) {
        const details = [
          legacy.inertDirectories.length > 0 ? `inert directories: ${legacy.inertDirectories.join(', ')}` : null,
          legacy.staleFiles.length > 0 ? `unmigrated content: ${legacy.staleFiles.join(', ')}` : null,
        ].filter(Boolean).join('; ');
        return {
          name,
          status: 'warn',
          message: `Migrated checkout retains legacy state (${details}).`,
          fix: 'Remove empty directories only after confirming them empty; compare unmigrated content with overdeck-state before deletion.',
        };
      }
      switch (result.status) {
        case 'legacy': return { name, status: 'ok', message: 'Legacy state layout (migration not complete)' };
        case 'healthy': return { name, status: 'ok', message: `Healthy overdeck-state worktree at ${result.path}` };
        case 'created':
        case 'recreated':
          return { name, status: 'ok', message: `${result.status === 'created' ? 'Created' : 'Recreated'} overdeck-state worktree at ${result.path}` };
        case 'dirty':
          return { name, status: 'warn', message: `${result.detail}: ${result.path}`, fix: 'Inspect and commit or surface the state-worktree changes; Doctor will not discard them.' };
        case 'error':
          return { name, status: 'warn', message: `Could not repair ${result.path}: ${result.detail}`, fix: 'Inspect the registered git worktrees and run pan doctor again.' };
      }
    } catch (error) {
      return {
        name: `State Worktree: ${key} (${config.name})`,
        status: 'warn',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Verify the overdeck-state remote branch and run pan doctor again.',
      };
    }
  }));
}

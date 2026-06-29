import { Command } from 'commander';
import { createCommand } from './workspace-create.js';
import { destroyCommand, listCommand } from './workspace-list.js';
import { addRepoCommand, updateCommand, useConfigCommand } from './workspace-maintenance.js';
import {
  migrateCommand,
  sshCommand,
  startCommand,
  stopCommand,
  syncAuthCommand,
} from './workspace-remote.js';

export { __testInternals } from './workspace-beads.js';
export { destroyCommand } from './workspace-list.js';

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command('workspace').description('Workspace management');

  workspace
    .command('create <issueId>')
    .description('Create workspace for issue')
    .option('--dry-run', 'Show what would be created')
    .option('--no-skills', 'Skip skills/agents installation')
    .option('--labels <labels>', 'Comma-separated labels for routing (e.g., docs,marketing)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .option('--docker', 'Start Docker containers after workspace creation')
    .option('--remote', 'Create workspace on remote VM (Fly.io)')
    .option('--local', 'Create workspace locally (explicit override)')
    .action(createCommand);

  workspace
    .command('migrate <issueId>')
    .description('Migrate workspace between local and remote (stops+pauses the local agent, commits and pushes all work first)')
    .option('--to <location>', 'Target location: "remote" or "local" (default: auto-detect from current location)')
    .option('--keep', 'Keep the source workspace after migration')
    .option('--force', 'Overwrite an existing destination workspace / ignore branch-drift guard')
    .action(migrateCommand);

  workspace
    .command('ssh <issueId>')
    .description('SSH into remote workspace VM')
    .action(sshCommand);

  workspace
    .command('sync-auth <issueId>')
    .description('Sync Claude Code credentials to remote workspace')
    .action(syncAuthCommand);

  workspace
    .command('start <issueId>')
    .description('Start a stopped remote workspace')
    .action(startCommand);

  workspace
    .command('stop <issueId>')
    .description('Stop (hibernate) a remote workspace')
    .action(stopCommand);

  workspace
    .command('list')
    .description('List all workspaces')
    .option('--json', 'Output as JSON')
    .option('--all', 'List workspaces across all registered projects')
    .action(listCommand);

  workspace
    .command('destroy <issueId>')
    .description('Destroy workspace')
    .option('--force', 'Force removal even with uncommitted changes')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(destroyCommand);

  // Re-render `<workspace>/.devcontainer/` from the project's compose
  // template. Idempotent. The single source of truth for how the
  // devcontainer files look — used by project-specific bootstrap scripts
  // (e.g. MYN's `infra/new-feature`) instead of duplicating the render in
  // bash + `sed`. See MIN-848.
  workspace
    .command('render-devcontainer <featureName>')
    .description('Re-render <workspace>/.devcontainer/ from the project compose template')
    .option('--project <key>', 'Project key in projects.yaml (e.g. mind-your-now)')
    .option('--workspace <path>', 'Override the inferred workspace path')
    .option('--json', 'Emit JSON instead of human-readable output')
    .action(
      async (
        featureName: string,
        opts: { project?: string; workspace?: string; json?: boolean },
      ) => {
        const { workspaceRenderDevcontainerCommand } = await import(
          './workspace-render-devcontainer.js'
        );
        await workspaceRenderDevcontainerCommand(featureName, opts);
      },
    );

  // The ONLY allowed call site for `git clean -fd` against a workspace.
  // Refuses to run if stdin is not a TTY. Lists what would be deleted, asks
  // the user to type the issue ID to confirm, then runs the chokepointed
  // `runGitClean(..., userInvoked: true)`. See:
  //   src/lib/safety/dangerous-git-ops.ts
  //   src/cli/commands/workspace-deep-clean.ts
  workspace
    .command('deep-clean <issueId>')
    .description(
      'Interactive: git clean -fd against a workspace (preserves protected paths)',
    )
    .option('--yes', 'Skip confirmation prompt (still requires a TTY)')
    .action(async (issueId: string, opts: { yes?: boolean }) => {
      const { workspaceDeepCleanCommand } = await import('./workspace-deep-clean.js');
      await workspaceDeepCleanCommand(issueId, opts);
    });

  workspace
    .command('rebuild <issueId>')
    .description('Tear down, re-render, and restart a single workspace Docker stack')
    .action(async (issueId: string) => {
      const { workspaceRebuildCommand } = await import('./workspace-rebuild.js');
      await workspaceRebuildCommand(issueId);
    });

  workspace
    .command('reap')
    .description('List or remove orphaned unhealthy workspace Docker stacks')
    .option('--days <days>', 'Minimum age in days', '7')
    .option('--apply', 'Run docker compose down -v --remove-orphans for candidates')
    .option('--yes', 'Skip confirmation when using --apply')
    .action(async (opts: { days?: string; apply?: boolean; yes?: boolean }) => {
      const { workspaceReapCommand } = await import('./workspace-reap.js');
      await workspaceReapCommand(opts);
    });

  workspace
    .command('update <issueId>')
    .description('Update skills/agents/rules in an existing workspace')
    .option('--force', 'Overwrite user-modified files')
    .action(updateCommand);

  workspace
    .command('use-config <issueId>')
    .description('Copy installed Overdeck config into workspace (makes it user settings)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(useConfigCommand);

  workspace
    .command('add-repo <workspaceId> <repoNames...>')
    .description('Add repositories to a progressive polyrepo workspace')
    .option('--dry-run', 'Show what would be added')
    .option('--group <groupName>', 'Add all repos from a named group (from groups_file)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(addRepoCommand);
}

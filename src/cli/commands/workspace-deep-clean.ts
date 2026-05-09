/**
 * `pan workspace deep-clean <issueId>` — interactive, user-only entry point
 * for `git clean -fd` against a workspace.
 *
 * This command is the ONLY allowed call site for `runGitClean` in the
 * codebase. Every other path that previously auto-cleaned now refuses and
 * points the user here.
 *
 * Behaviour:
 *   1. Refuse to run if stdin is not a TTY (no agent / scripted invocation).
 *   2. Run `git clean -fdn` (dry-run) to list what would be deleted, with
 *      protected paths from `safety/protected-paths.ts` already excluded.
 *   3. Print a giant red banner + the list, ask the user to type the issue
 *      ID to confirm.
 *   4. Only then call `runGitClean` with `userInvoked: true`.
 *
 * The protected list is enforced server-side in `dangerous-git-ops.ts`. The
 * user cannot pass `--no-protect` or similar — there is no such flag.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline/promises';
import chalk from 'chalk';
import {
  dryRunGitClean,
  runGitClean,
  DangerousOpBlockedError,
} from '../../lib/safety/dangerous-git-ops.js';
import { GIT_CLEAN_EXCLUDES } from '../../lib/safety/protected-paths.js';
import { extractTeamPrefix, findProjectByTeam } from '../../lib/projects.js';

export interface WorkspaceDeepCleanOptions {
  /** Skip the interactive confirmation. Only honoured when stdin is a TTY. */
  yes?: boolean;
}

export async function workspaceDeepCleanCommand(
  issueId: string,
  options: WorkspaceDeepCleanOptions = {},
): Promise<void> {
  // Require a real TTY. An agent or scripted runner cannot reach this path.
  if (!process.stdin.isTTY) {
    console.error(
      chalk.red.bold(
        '\n✗ pan workspace deep-clean requires an interactive terminal.\n'
      ) +
        chalk.dim(
          '  This command performs an irreversible git clean against a workspace.\n' +
            '  It must be invoked by a human at a TTY — not by an agent, hook, or\n' +
            "  scripted flow. If you're sure you want this, run it manually.\n",
        ),
    );
    process.exit(2);
  }

  const issueLower = issueId.toLowerCase();
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
  if (!projectConfig) {
    console.error(chalk.red(`✗ No project found for issue ${issueId}`));
    process.exit(1);
  }

  const workspacePath = join(projectConfig.path, 'workspaces', `feature-${issueLower}`);
  if (!existsSync(workspacePath)) {
    console.error(chalk.red(`✗ Workspace not found: ${workspacePath}`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.red.bold('═'.repeat(72)));
  console.log(chalk.red.bold('  ⚠  DANGEROUS OPERATION: git clean -fd'));
  console.log(chalk.red.bold('═'.repeat(72)));
  console.log();
  console.log(`  workspace:  ${chalk.cyan(workspacePath)}`);
  console.log(`  issue:      ${chalk.cyan(issueId)}`);
  console.log();
  console.log(chalk.dim('  Protected (always preserved):'));
  for (const p of GIT_CLEAN_EXCLUDES) {
    console.log(chalk.dim(`    • ${p}`));
  }
  console.log();

  let toDelete: string[];
  try {
    toDelete = await dryRunGitClean({ workspacePath });
  } catch (err: any) {
    console.error(chalk.red(`✗ git clean dry-run failed: ${err.message ?? err}`));
    process.exit(1);
  }

  if (toDelete.length === 0) {
    console.log(chalk.green('  Nothing to clean — workspace has no untracked files'));
    console.log(chalk.green('  (after applying the protected list).\n'));
    return;
  }

  console.log(chalk.yellow(`  Would delete ${toDelete.length} item(s):`));
  for (const path of toDelete.slice(0, 50)) {
    console.log(chalk.yellow(`    × ${path}`));
  }
  if (toDelete.length > 50) {
    console.log(chalk.yellow(`    × ... and ${toDelete.length - 50} more`));
  }
  console.log();

  if (!options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const expected = issueId.toUpperCase();
      const answer = (
        await rl.question(
          chalk.bold(`  Type "${expected}" to confirm, anything else to cancel: `),
        )
      ).trim().toUpperCase();
      if (answer !== expected) {
        console.log(chalk.green('\n  Cancelled — nothing was deleted.\n'));
        return;
      }
    } finally {
      rl.close();
    }
  } else {
    console.log(chalk.dim('  --yes given; skipping interactive confirmation.\n'));
  }

  try {
    await runGitClean({
      workspacePath,
      userInvoked: true,
      reason: `pan workspace deep-clean ${issueId} (TTY-confirmed)`,
    });
  } catch (err: any) {
    if (err instanceof DangerousOpBlockedError) {
      console.error(chalk.red(`\n✗ ${err.message}\n  ${err.recovery}\n`));
    } else {
      console.error(chalk.red(`✗ git clean failed: ${err.message ?? err}`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`\n  ✓ Deleted ${toDelete.length} item(s) from ${workspacePath}\n`));
  console.log(
    chalk.dim(
      '  Tip: regenerable artifacts (.devcontainer/, .env, node_modules) will be\n' +
        '  re-created automatically the next time the workspace is started.\n',
    ),
  );
}

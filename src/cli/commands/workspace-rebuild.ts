import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';

import {
  composeProjectNameForWorkspace,
  rebuildWorkspaceStack,
} from '../../lib/workspace/rebuild-stack.js';

// Re-exported for backward compatibility — the rebuild primitive now lives in
// src/lib/workspace/rebuild-stack.ts so server-side callers (the deacon) can
// use it without pulling in the CLI command's spinner/exit handling.
export { composeProjectNameForWorkspace };

export async function workspaceRebuildCommand(issueId: string): Promise<void> {
  const spinner = ora(`Rebuilding workspace stack for ${issueId.toUpperCase()}...`).start();

  const result = await Effect.runPromise(rebuildWorkspaceStack(issueId, {
    onProgress: (message) => {
      spinner.text = message;
    },
  }));

  if (!result.success) {
    spinner.fail(`Workspace rebuild failed: ${result.error}`);
    process.exit(1);
  }

  spinner.succeed(`Workspace stack rebuilt for ${issueId.toUpperCase()}`);
  console.log(chalk.dim(`  workspace: ${result.workspacePath}`));
  console.log(chalk.dim(`  compose:   ${result.composeFile}`));
  console.log(chalk.dim(`  project:   ${result.composeProjectName}`));
}

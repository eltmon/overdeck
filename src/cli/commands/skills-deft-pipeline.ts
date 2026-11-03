/**
 * `pan skills deft use|back|save|show` — run one issue on Deft Directive's
 * pipeline (PAN-4820).
 *
 *   pan skills deft use <issue> [--start] [--json]   switch the issue onto Deft's pipeline
 *   pan skills deft back <issue> [--json]            switch it back to Overdeck's pipeline
 *   pan skills deft save <issue>                     commit the Deft state archive
 *   pan skills deft show <issue> [--json]            pipeline, install, drift, merge guard
 *
 * Registered from `./skills-deft.ts`; like it, this module imports only
 * Commander types and chalk statically. A refusal prints its message on
 * stderr and exits 1.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

interface JsonOption { json?: boolean }
interface UseOptions extends JsonOption { start?: boolean }

const upper = (issue: string): string => issue.trim().toUpperCase();

function refuse(error: unknown): void {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

async function issueWorkspace(issueId: string): Promise<string> {
  const { getIssueWorkspacePath } = await import('../../lib/overdeck/issue-projects.js');
  const workspace = getIssueWorkspacePath(issueId);
  if (!workspace) throw new Error(`no registered project owns ${issueId}`);
  return workspace;
}

/** Run `pan start <issue>` with inherited stdio; resolves its exit code. */
async function panStart(issueId: string): Promise<number> {
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    const child = spawn('pan', ['start', issueId], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', code => resolve(code ?? 1));
  });
}

export async function skillsDeftUseCommand(issue: string, options: UseOptions = {}): Promise<void> {
  const issueId = upper(issue);
  try {
    const { useDeftPipeline } = await import('../../lib/deft/switch.js');
    const result = await useDeftPipeline(issueId);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Deft pipeline on for ${issueId}: ${result.mode}; ${result.snapshotPaths.length} install paths hidden.`);
  } catch (error) {
    refuse(error);
    return;
  }
  if (options.start) {
    const code = await panStart(issueId);
    if (code !== 0) process.exitCode = code;
  }
}

export async function skillsDeftBackCommand(issue: string, options: JsonOption = {}): Promise<void> {
  const issueId = upper(issue);
  try {
    const { backToOverdeck } = await import('../../lib/deft/switch.js');
    const result = await backToOverdeck(issueId);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Overdeck pipeline on for ${issueId}: ${result.removed.length} install paths removed, ${result.restored.length} files restored.`);
    if (result.snapshotMissing) {
      console.error(chalk.yellow(
        `Warning: no readable install snapshot for ${issueId}, so the exact undo was not possible. `
        + `Cleared the worktree hooks path, the exclude file and ${result.unhidden?.length ?? 0} skip-worktree flags `
        + `(${result.unhidden?.join(', ') || 'none'}). The install's files are visible to git again: `
        + 'review git status in the workspace and discard what you do not want.',
      ));
    }
    console.log(`Next: pan start ${issueId} (plans first)`);
  } catch (error) {
    refuse(error);
  }
}

export async function skillsDeftSaveCommand(issue: string): Promise<void> {
  const issueId = upper(issue);
  try {
    const { saveDeftState } = await import('../../lib/deft/archive.js');
    const result = await saveDeftState(await issueWorkspace(issueId), issueId);
    console.log(result.committed
      ? `Saved Deft state for ${issueId}: ${result.files} files in ${result.sha?.slice(0, 12)}.`
      : `Deft state for ${issueId} is already saved (${result.files} files).`);
  } catch (error) {
    refuse(error);
  }
}

export async function skillsDeftShowCommand(issue: string, options: JsonOption = {}): Promise<void> {
  const issueId = upper(issue);
  try {
    const [{ readIssuePipeline }, { readDeftSnapshot }, { isNativeDirectiveProject }, { detectDrift, deftMergeGuardForIssue }, { execFile }, { promisify }] =
      await Promise.all([
        import('../../lib/deft/issue-pipeline.js'),
        import('../../lib/deft/install-snapshot.js'),
        import('../../lib/deft/archive.js'),
        import('../../lib/deft/merge-guard.js'),
        import('node:child_process'),
        import('node:util'),
      ]);
    const workspace = await issueWorkspace(issueId);
    const pipeline = await readIssuePipeline(issueId);
    const snapshot = await readDeftSnapshot(workspace);
    const mode = snapshot ? 'temporary-install' : (await isNativeDirectiveProject(workspace)) ? 'directive-project' : 'not installed';
    const drift = await detectDrift(workspace, snapshot);
    const head = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim();
    const guard = await deftMergeGuardForIssue(issueId, head);
    const report = {
      issueId,
      pipeline,
      mode,
      workspace,
      runtimeVersion: snapshot?.runtimeVersion ?? null,
      hiddenPaths: snapshot ? [...snapshot.createdPaths, ...snapshot.modifiedTracked.map(entry => entry.path)] : [],
      drift,
      liftConflicts: snapshot?.liftConflicts ?? [],
      mergeGuard: { head, ok: guard.ok, ...(guard.ok ? {} : { reason: guard.reason }) },
    };
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const list = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : 'none');
    console.log(`Issue:          ${issueId}`);
    console.log(`Pipeline:       ${pipeline}`);
    console.log(`Mode:           ${mode}`);
    console.log(`Workspace:      ${workspace}`);
    console.log(`Runtime:        ${report.runtimeVersion ?? 'none'}`);
    console.log(`Hidden paths:   ${list(report.hiddenPaths)}`);
    console.log(`Drift:          ${list(drift)}`);
    console.log(`Lift conflicts: ${list(report.liftConflicts)}`);
    console.log(`Merge guard:    ${guard.ok ? 'ok' : `refuses: ${guard.reason}`} (at ${head.slice(0, 12)})`);
  } catch (error) {
    refuse(error);
  }
}

/** Registers the per-issue pipeline verbs under `pan skills deft`. */
export function registerSkillsDeftPipelineCommands(deft: Command): void {
  deft.command('use <issue>').description("Run an issue on Deft Directive's pipeline: install Directive into its workspace, hidden from git")
    .option('--start', 'Start the work agent afterwards (pan start)').option('--json', 'Output as JSON')
    .action(skillsDeftUseCommand);
  deft.command('back <issue>').description("Switch an issue back to Overdeck's pipeline: save the Deft state, then remove the install")
    .option('--json', 'Output as JSON')
    .action(skillsDeftBackCommand);
  deft.command('save <issue>').description("Commit the issue's Deft state archive under .pan/deft/<ISSUE>/")
    .action(skillsDeftSaveCommand);
  deft.command('show <issue>').description("Show an issue's pipeline, Deft install, drift, and merge-guard verdict")
    .option('--json', 'Output as JSON')
    .action(skillsDeftShowCommand);
}

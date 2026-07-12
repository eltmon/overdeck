import { Command } from 'commander';

import { reconcileBeads } from '../../../lib/beads/reconcile.js';
import { getProjectSync, resolveInfraRepo } from '../../../lib/projects.js';
import { stateWorktreePath } from '../../../lib/state-home.js';

export async function runBeadsReconcile(projectKey: string, json = false): Promise<void> {
  const project = getProjectSync(projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  const { repoPath } = resolveInfraRepo(project);
  const { stdout } = await import('node:child_process').then(({ execFile }) => new Promise<{ stdout: string }>((resolve, reject) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd: repoPath, encoding: 'utf8' }, (error, output) => error ? reject(error) : resolve({ stdout: output }));
  }));
  const result = await reconcileBeads({ projectKey, projectPath: repoPath, stateRoot: stateWorktreePath(project, { projectKey }), remoteUrl: stdout.trim() });
  console.log(json ? JSON.stringify(result, null, 2) : `Reconciliation report written to ${result.reportPath}. Review and approve it before creating a beads cutover marker.`);
}

export function registerBeadsReconcileCommand(beads: Command): void {
  beads.command('reconcile <project>')
    .description('Audit local Dolt, isolated refs/dolt/data, and derived JSONL without mutating any source')
    .option('--json', 'Print the result as JSON')
    .action((project: string, options: { json?: boolean }) => runBeadsReconcile(project, options.json));
}

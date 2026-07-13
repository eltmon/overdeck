import { Command } from 'commander';

import { reconcileBeads, type ReconcileExtraStore } from '../../../lib/beads/reconcile.js';
import { getProjectSync, resolveInfraRepo } from '../../../lib/projects.js';
import { stateWorktreePath } from '../../../lib/state-home.js';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseExtraStore(raw: string): ReconcileExtraStore {
  const separatorIndex = raw.indexOf('=');
  if (separatorIndex === -1) {
    throw new Error(`--store value must be name=path: ${raw}`);
  }
  return {
    name: raw.slice(0, separatorIndex),
    path: raw.slice(separatorIndex + 1),
  };
}

export async function runBeadsReconcile(projectKey: string, options: { json?: boolean; store?: string[] }): Promise<void> {
  const project = getProjectSync(projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  const { repoPath } = resolveInfraRepo(project);
  const { stdout } = await import('node:child_process').then(({ execFile }) => new Promise<{ stdout: string }>((resolve, reject) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd: repoPath, encoding: 'utf8' }, (error, output) => error ? reject(error) : resolve({ stdout: output }));
  }));
  const extraStores = (options.store ?? []).map(parseExtraStore);
  const result = await reconcileBeads({ projectKey, projectPath: repoPath, stateRoot: stateWorktreePath(project, { projectKey }), remoteUrl: stdout.trim(), extraStores });
  console.log(options.json ? JSON.stringify(result, null, 2) : `Reconciliation report written to ${result.reportPath}. Review and approve it before creating a beads cutover marker.`);
}

export function registerBeadsReconcileCommand(beads: Command): void {
  beads.command('reconcile <project>')
    .description('Audit local Dolt, isolated refs/dolt/data, derived JSONL, and optional extra stores without mutating any source')
    .option('--json', 'Print the result as JSON')
    .option('--store <name=path>', 'Additional local .beads store (repeatable)', collect, [])
    .action((project: string, options: { json?: boolean; store?: string[] }) => runBeadsReconcile(project, options));
}

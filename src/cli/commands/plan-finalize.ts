import chalk from 'chalk';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createBeadsFromVBrief } from '../../lib/vbrief/beads.js';
import { findPlan } from '../../lib/vbrief/io.js';
import { emitActivityEntry, emitActivityTts } from '../../lib/activity-logger.js';

interface PlanFinalizeOptions {
  workspace?: string;
  json?: boolean;
}

function findWorkspaceRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, '.planning', 'plan.vbrief.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function planFinalizeCommand(options: PlanFinalizeOptions = {}): Promise<void> {
  const startDir = options.workspace ? resolve(options.workspace) : process.cwd();
  const workspacePath = findWorkspaceRoot(startDir);

  if (!workspacePath) {
    const msg = 'No .planning/plan.vbrief.json found in current directory or any parent. Run this from a workspace where the planning agent wrote a vBRIEF plan.';
    if (options.json) console.log(JSON.stringify({ success: false, error: msg }));
    else console.error(chalk.red('✗ ' + msg));
    process.exit(1);
  }

  if (!findPlan(workspacePath)) {
    const msg = `vBRIEF plan not readable at ${workspacePath}/.planning/plan.vbrief.json`;
    if (options.json) console.log(JSON.stringify({ success: false, error: msg }));
    else console.error(chalk.red('✗ ' + msg));
    process.exit(1);
  }

  if (!options.json) {
    console.log(chalk.dim(`workspace: ${workspacePath}`));
    console.log(chalk.dim('creating beads from vBRIEF plan…'));
  }

  const result = await createBeadsFromVBrief(workspacePath);

  if (!result.success || result.created.length === 0) {
    const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
    if (options.json) {
      console.log(JSON.stringify({ success: false, created: result.created, errors }));
    } else {
      console.error(chalk.red('✗ Beads creation failed:'));
      for (const e of errors) console.error(chalk.red('  ' + e));
    }
    process.exit(2);
  }

  const markerPath = join(workspacePath, '.planning', '.planning-complete');
  writeFileSync(markerPath, '', 'utf-8');

  // Derive issue ID from workspace directory name (feature-<id> or <id>)
  const workspaceName = workspacePath.split('/').pop() || '';
  const issueId = workspaceName.replace(/^feature-/, '').toUpperCase();
  emitActivityEntry({
    source: 'planning-agent',
    level: 'info',
    message: `${issueId} planning finalized — awaiting your approval`,
    issueId,
  });
  emitActivityTts({
    utterance: `${issueId} planning is done, awaiting your approval`,
    priority: 1,
    issueId,
  });

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      created: result.created,
      count: result.created.length,
      marker: markerPath,
    }));
  } else {
    console.log(chalk.green(`✓ Created ${result.created.length} beads task${result.created.length === 1 ? '' : 's'}`));
    for (const id of result.created) console.log(chalk.dim('  • ' + id));
    console.log(chalk.green(`✓ Wrote completion marker: ${markerPath}`));
    console.log('');
    console.log(chalk.cyan('Planning is finalized. The dashboard will now show the Done button.'));
    console.log(chalk.dim('You can exit this session — the user will click Done to start implementation.'));
  }
}

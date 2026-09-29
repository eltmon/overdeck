/**
 * `pan models preset` (PAN-4400): list, preview, apply and undo the provider
 * model presets. It calls the same lib as the dashboard routes, so the diff
 * here matches the Settings dialog; `--json` output is the route's JSON body.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline/promises';
import { applyPreset, listPresetStatus, undoLastPresetApply } from '../../lib/model-presets/apply.js';
import { formatPresetPlanText } from '../../lib/model-presets/format.js';
import { planPresetApply } from '../../lib/model-presets/plan.js';

interface JsonOption {
  json?: boolean;
}

interface ApplyOptions extends JsonOption {
  dryRun?: boolean;
  yes?: boolean;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/** Prints the error and sets exit code 1 instead of throwing a stack at the operator. */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
}

export async function runPresetList(options: JsonOption): Promise<void> {
  const status = await listPresetStatus();
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  for (const preset of status.presets) {
    const marks = [
      preset.pilot ? 'pilot' : undefined,
      preset.evidence.status === 'eval' ? 'eval-backed' : 'research-backed',
      preset.lastApplied ? `applied ${preset.lastApplied.appliedAt} (v${preset.lastApplied.version})` : undefined,
      preset.updateAvailable ? chalk.yellow(`updated: v${preset.version} available`) : undefined,
    ].filter(Boolean);
    console.log(`${chalk.bold(preset.id.padEnd(22))} ${preset.label} v${preset.version} (${preset.date})  ${marks.join(', ')}`);
  }
  if (status.undoAvailable) console.log(chalk.dim('\nUndo the last apply with: pan models preset undo'));
}

export async function runPresetShow(id: string, options: JsonOption): Promise<void> {
  const plan = await planPresetApply(id);
  console.log(options.json ? JSON.stringify(plan, null, 2) : formatPresetPlanText(plan));
  if (plan.blocked) process.exitCode = 1;
}

export async function runPresetApply(id: string, options: ApplyOptions): Promise<void> {
  const plan = await planPresetApply(id);
  if (options.dryRun || !options.yes || plan.blocked) {
    console.log(options.json ? JSON.stringify(plan, null, 2) : formatPresetPlanText(plan));
  }
  if (plan.blocked) {
    if (!options.json) console.error(chalk.red(`\nNot applied: ${plan.blocked.reason}`));
    process.exitCode = 1;
    return;
  }
  if (options.dryRun) return;

  const changes = plan.rows.filter((row) => row.status === 'change').length;
  if (changes === 0) {
    console.log(`${plan.label} is already applied; nothing to change.`);
    return;
  }
  if (!options.yes && !(await confirm(`\nApply these ${changes} changes? [y/N] `))) {
    console.log('Not applied.');
    return;
  }
  const result = await applyPreset(id, { expectedDigest: plan.digest });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(chalk.green(`Applied ${plan.label}: ${result.applied.length} settings changed, ${result.skipped.length} not set. Undo with: pan models preset undo`));
}

export async function runPresetUndo(options: JsonOption): Promise<void> {
  const result = await undoLastPresetApply();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(chalk.green(`Restored ${result.restored.length} settings.`));
  for (const path of result.restored) console.log(`  ${path}`);
  if (result.leftAsIs.length > 0) {
    console.log(chalk.yellow(`Left ${result.leftAsIs.length} settings as they are:`));
    for (const entry of result.leftAsIs) console.log(`  ${entry.path}: ${entry.reason}`);
  }
}

export function createModelsCommand(): Command {
  const models = new Command('models').description('Model settings: provider presets');
  const preset = models
    .command('preset')
    .description('Apply eval-backed provider model presets (writes explicit values once; never auto-applies)');

  preset
    .command('list')
    .description('List presets, their versions and what was last applied')
    .option('--json', 'Print JSON')
    .action((options: JsonOption) => run(() => runPresetList(options)));

  preset
    .command('show <id>')
    .description('Show the per-setting diff a preset would make to config.yaml')
    .option('--json', 'Print the plan JSON (same body as GET /api/model-presets/:id/plan)')
    .action((id: string, options: JsonOption) => run(() => runPresetShow(id, options)));

  preset
    .command('apply <id>')
    .description('Apply a preset: print the diff, confirm, then write only the changed settings')
    .option('--dry-run', 'Print the diff and write nothing')
    .option('--yes', 'Apply without the confirmation prompt')
    .option('--json', 'Print JSON')
    .action((id: string, options: ApplyOptions) => run(() => runPresetApply(id, options)));

  preset
    .command('undo')
    .description('Restore the values the last preset apply replaced')
    .option('--json', 'Print JSON')
    .action((options: JsonOption) => run(() => runPresetUndo(options)));

  return models;
}

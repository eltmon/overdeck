/**
 * `pan skills` — list skills with their effective on/off state and set
 * per-level overrides (PAN-3942).
 *
 *   pan skills [list] [--project <key>] [--issue <id>] [--json]
 *   pan skills set <skill> on|off|inherit [--project <key> | --issue <id>]
 *   pan skills launch-settings --harness <h> --cwd <dir> [--issue <id>] [--codex-home <dir>] [--plugin-link <path>]   (hidden; launchers)
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. The
 * override logic loads inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

interface ListOptions { project?: string; issue?: string; json?: boolean }
interface SetOptions { project?: string; issue?: string }
interface LaunchSettingsOptions { harness: string; cwd: string; issue?: string; codexHome?: string; pluginLink?: string }

const STATES = { on: true, off: false, inherit: null } as const;

async function failOnOverrideError(error: unknown): Promise<never> {
  const { SkillOverrideError } = await import('../../lib/skill-overrides/store.js');
  if (error instanceof SkillOverrideError) {
    console.error(chalk.red(error.message));
    process.exit(1);
  }
  throw error;
}

export async function skillsListCommand(options: ListOptions): Promise<void> {
  const { listSkillStates } = await import('../../lib/skill-overrides/store.js');
  let result;
  try {
    result = await listSkillStates({ projectKey: options.project, issueId: options.issue });
  } catch (error) {
    return failOnOverrideError(error);
  }

  if (options.json) {
    console.log(JSON.stringify(result.skills, null, 2));
    return;
  }

  const context = [result.project && `project ${result.project}`, result.issue && `issue ${result.issue}`].filter(Boolean).join(', ');
  console.log(chalk.bold(`\nSkills (${result.skills.length})${context ? ` for ${context}` : ''}\n`));
  if (result.skills.length === 0) {
    console.log(chalk.yellow('No skills found. Run "pan sync" to install them.'));
    return;
  }
  const nameWidth = Math.max(4, ...result.skills.map(skill => skill.name.length));
  console.log(chalk.dim(`${'NAME'.padEnd(nameWidth)}  STATE  ${'SOURCE'.padEnd(7)}  DESCRIPTION`));
  for (const skill of result.skills) {
    const state = skill.enabled ? 'on ' : 'off';
    console.log(`${skill.name.padEnd(nameWidth)}  ${state}    ${skill.source.padEnd(7)}  ${chalk.dim(skill.description)}`);
  }
  console.log(chalk.dim('\nChanges apply to Claude Code and Codex agents at their next launch.'));
}

export async function skillsSetCommand(skill: string, state: string, options: SetOptions): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(STATES, state)) {
    console.error(chalk.red('state must be on, off, or inherit'));
    process.exit(1);
  }
  if (options.project && options.issue) {
    console.error(chalk.red('use either --project or --issue, not both'));
    process.exit(1);
  }
  const enabled = STATES[state as keyof typeof STATES];
  const { setSkillOverride } = await import('../../lib/skill-overrides/store.js');
  const issueId = options.issue?.toUpperCase();
  const update = options.project
    ? { level: 'project' as const, skill, enabled, projectKey: options.project }
    : issueId
      ? { level: 'issue' as const, skill, enabled, issueId }
      : { level: 'global' as const, skill, enabled };

  let result;
  try {
    result = await setSkillOverride(update);
  } catch (error) {
    return failOnOverrideError(error);
  }

  const where = update.level === 'global' ? 'global' : update.level === 'project' ? `project ${options.project}` : `issue ${issueId}`;
  // Global is two-state: "on" and "inherit" both clear the stored override.
  const shown = update.level === 'global' && enabled !== false ? 'on (default)' : state;
  let outcome = '';
  if (result.committed) {
    const push = result.pushed ? 'pushed' : `push pending: ${result.reason ?? 'unknown'}`;
    outcome = ` (committed ${result.sha?.slice(0, 7) ?? ''}, ${push})`;
  }
  console.log(`${skill}: ${shown} at ${where}${outcome}`);
}

export async function skillsLaunchSettingsCommand(options: LaunchSettingsOptions): Promise<void> {
  if (options.harness !== 'claude-code' && options.harness !== 'codex') {
    console.error(`unsupported harness: ${options.harness}`);
    process.exit(2);
  }
  if (options.harness === 'codex' && !options.codexHome) {
    console.error('--codex-home is required for --harness codex');
    process.exit(1);
  }
  const launch = await import('../../lib/skill-overrides/launch.js');
  const ctx = { cwd: options.cwd, issueId: options.issue };
  const disabled = await launch.resolveLaunchDisabledSkills(ctx);
  if (options.harness === 'claude-code') {
    const json = launch.claudeSkillSettingsJson(disabled);
    const link = options.pluginLink;
    if (link) {
      // Fail open (NFR-1): a pack error drops the packs, never the launch or the settings JSON.
      await applyPacksFailOpen(() => launch.applyClaudePacks(ctx, link), async () => {
        const { rm } = await import('node:fs/promises');
        await rm(link, { force: true });
      });
    }
    // Stdout carries only the settings JSON; the launcher parses it.
    if (json) process.stdout.write(`${json}\n`);
    return;
  }
  const codexHome = options.codexHome as string;
  await launch.writeCodexSkillOverrides(codexHome, disabled);
  await applyPacksFailOpen(() => launch.applyCodexPacks(ctx, codexHome), async () => {
    const { writeCodexPackBlock } = await import('../../lib/skill-packs/mount.js');
    await writeCodexPackBlock(codexHome, null);
  });
}

async function applyPacksFailOpen(apply: () => Promise<string[]>, clear: () => Promise<void>): Promise<void> {
  try {
    for (const warning of await apply()) console.error(warning);
  } catch (error) {
    console.error(`[launcher] WARNING: skill packs not applied: ${error instanceof Error ? error.message : String(error)}`);
    await clear().catch(() => undefined);
  }
}

/** Registers `pan skills` and its subcommands. */
export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('List skills and set per-level on/off overrides');
  skills.command('list', { isDefault: true }).description('List skills with effective on/off state and its source')
    .option('--project <key>', 'Resolve for a project').option('--issue <id>', 'Resolve for an issue').option('--json', 'Output as JSON')
    .action(skillsListCommand);
  skills.command('set <skill> <state>').description('Set a skill on, off, or inherit (global unless --project/--issue)')
    .option('--project <key>', 'Project override').option('--issue <id>', 'Issue override')
    .action(skillsSetCommand);
  skills.command('launch-settings', { hidden: true }).description('Resolve skill overrides for a managed launch (used by launchers)')
    .requiredOption('--harness <harness>', 'claude-code or codex').requiredOption('--cwd <dir>', 'Launch working directory')
    .option('--issue <id>', 'Issue id').option('--codex-home <dir>', 'CODEX_HOME to write (codex)')
    .option('--plugin-link <path>', 'Per-launch skill pack plugin link to point at the mount (claude-code)')
    .action(skillsLaunchSettingsCommand);
}

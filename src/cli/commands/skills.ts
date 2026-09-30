/**
 * `pan skills` — list skills with their effective on/off state and set
 * per-level overrides (PAN-3942).
 *
 *   pan skills [list] [--project <key>] [--issue <id>] [--json]
 *   pan skills set <skill> on|off|inherit [--project <key> | --issue <id>]
 *   pan skills set --pack <id> on|off|inherit [--project <key> | --issue <id>]   (PAN-4334; <skill> may be <pack>/<skill>)
 *   pan skills launch-settings --harness <h> --cwd <dir> [--issue <id>] [--codex-home <dir>] [--plugin-link <path>]   (hidden; launchers)
 *   pan skills pack add <id> <url> --ref <ref> [--adapter plain|claude-plugin|deft-readonly] [--yes]      (PAN-4334)
 *   pan skills pack update <id> [--ref <ref>] [--yes]
 *   pan skills pack list [--json] [--offline] | remove <id> | sync [id] | gc [--max-age-days <n>]
 *   pan skills pack sageox status [--project <key>] [--json] | upload on|off --project <key>   (PAN-2444)
 *   pan skills deft status|enable|disable …   (PAN-3943; ./skills-deft.ts)
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. The
 * override logic loads inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import type { DeftLaunchResult } from '../../lib/skill-overrides/launch.js';
import { registerSkillsDeftCommands } from './skills-deft.js';

interface ListOptions { project?: string; issue?: string; json?: boolean }
interface SetOptions { project?: string; issue?: string; pack?: string }
interface LaunchSettingsOptions { harness: string; cwd: string; issue?: string; codexHome?: string; pluginLink?: string }
interface PackAddOptions { ref: string; adapter?: string; yes?: boolean }
interface PackUpdateOptions { ref?: string; yes?: boolean }
interface PackListOptions { json?: boolean; offline?: boolean }
interface PackGcOptions { maxAgeDays?: string }
interface SageoxStatusOptions { project?: string; json?: boolean }
interface SageoxUploadOptions { project: string }

type PackPreview = import('../../lib/skill-packs/sources.js').PackPreview;
type NotAppliedLabels = (capabilities: PackPreview['manifest']['capabilities']) => string[];

const STATES = { on: true, off: false, inherit: null } as const;
const SET_USAGE = 'usage: pan skills set <skill> on|off|inherit | pan skills set --pack <id> on|off|inherit [--project <key> | --issue <id>]';

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
  } else {
    const nameWidth = Math.max(4, ...result.skills.map(skill => skill.name.length));
    console.log(chalk.dim(`${'NAME'.padEnd(nameWidth)}  STATE  ${'SOURCE'.padEnd(7)}  DESCRIPTION`));
    for (const skill of result.skills) {
      const state = skill.enabled ? 'on ' : 'off';
      console.log(`${skill.name.padEnd(nameWidth)}  ${state}    ${skill.source.padEnd(7)}  ${chalk.dim(skill.description)}`);
    }
  }
  const packs = result.packs ?? [];
  if (packs.length > 0) {
    console.log(chalk.bold(`\nSkill packs (${packs.length})\n`));
    const width = Math.max(4, ...packs.flatMap(pack => [pack.id.length, ...pack.skills.map(skill => skill.id.length + 2)]));
    for (const pack of packs) {
      const cached = pack.cached ? '' : chalk.yellow(`  not cached; run pan skills pack sync ${pack.id}`);
      console.log(`${chalk.bold(pack.id.padEnd(width))}  ${pack.enabled ? 'on ' : 'off'}    ${pack.source}${cached}`);
      for (const skill of pack.skills) {
        console.log(`  ${skill.id.padEnd(width - 2)}  ${skill.enabled ? 'on ' : 'off'}    ${skill.source}${skill.optIn ? chalk.dim('  opt-in') : ''}`);
      }
    }
  }
  console.log(chalk.dim('\nChanges apply to Claude Code and Codex agents at their next launch.'));
}

export async function skillsSetCommand(args: string[], options: SetOptions): Promise<void> {
  // PD-9: with --pack exactly one positional (the state); without it, skill and state.
  if (args.length !== (options.pack ? 1 : 2)) {
    console.error(chalk.red(SET_USAGE));
    process.exit(1);
  }
  const state = args[args.length - 1] as string;
  const target = options.pack ? { pack: options.pack } : { skill: args[0] as string };
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
    ? { level: 'project' as const, ...target, enabled, projectKey: options.project }
    : issueId
      ? { level: 'issue' as const, ...target, enabled, issueId }
      : { level: 'global' as const, ...target, enabled };

  let result;
  try {
    result = await setSkillOverride(update);
  } catch (error) {
    return failOnOverrideError(error);
  }

  const where = update.level === 'global' ? 'global' : update.level === 'project' ? `project ${options.project}` : `issue ${issueId}`;
  // Global is two-state. Native skills: "on" and "inherit" both clear the key.
  // Packs: "off" and "inherit" both clear it. Pack skills show the chosen state.
  let shown = state;
  if ('pack' in target) {
    if (update.level === 'global') shown = enabled === true ? 'on' : 'off (default)';
  } else if (update.level === 'global' && !target.skill.includes('/') && enabled !== false) {
    shown = 'on (default)';
  }
  const label = 'pack' in target ? `${target.pack} (pack)` : target.skill;
  let outcome = '';
  if (result.committed) {
    const push = result.pushed ? 'pushed' : `push pending: ${result.reason ?? 'unknown'}`;
    outcome = ` (committed ${result.sha?.slice(0, 7) ?? ''}, ${push})`;
  }
  console.log(`${label}: ${shown} at ${where}${outcome}`);
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
  const [launch, { resolveSageoxLaunch, SAGEOX_PACK_ID }, { dirname, join }] = await Promise.all([
    import('../../lib/skill-overrides/launch.js'),
    import('../../lib/sageox/launch.js'),
    import('node:path'),
  ]);
  const ctx = { cwd: options.cwd, issueId: options.issue };
  const disabled = await launch.resolveLaunchDisabledSkills(ctx);
  // PAN-2444: SageOx wiring fails closed; when it is off, its skills are not mounted either.
  const sageox = await resolveSageoxLaunch(ctx, options.harness);
  for (const warning of sageox.warnings) console.error(warning);
  const exclude = new Set(sageox.active ? [] : [SAGEOX_PACK_ID]);
  if (options.harness === 'claude-code') {
    const link = options.pluginLink;
    // A Claude launch without a launch key (no plugin link) runs no Deft step.
    const deft = link
      ? await applyDeftFailOpen(join(dirname(link), 'deft.env'), async envFile =>
        launch.applyDeftForLaunch(ctx, envFile, await launch.launchMountsDeft(ctx)))
      : launch.EMPTY_DEFT_LAUNCH;
    const json = launch.claudeSkillSettingsJson(mergeSkillNames(disabled, deft.hideSkills), {
      ...sageox.settings,
      deny: deft.deny,
    });
    if (link) {
      // Fail open (NFR-1): a pack error drops the packs, never the launch or the settings JSON.
      await applyPacksFailOpen(() => launch.applyClaudePacks(ctx, link, exclude), async () => {
        const { rm } = await import('node:fs/promises');
        await rm(link, { force: true });
      });
    }
    // Stdout carries only the settings JSON; the launcher parses it.
    if (json) process.stdout.write(`${json}\n`);
    return;
  }
  const codexHome = options.codexHome as string;
  const deft = await applyDeftFailOpen(join(codexHome, 'overdeck-deft.env'), async envFile =>
    launch.applyDeftForLaunch(ctx, envFile, await launch.launchMountsDeft(ctx)));
  await launch.writeCodexSkillOverrides(codexHome, mergeSkillNames(disabled, deft.hideSkills));
  await applyPacksFailOpen(() => launch.applyCodexPacks(ctx, codexHome, exclude), async () => {
    const { writeCodexPackBlock } = await import('../../lib/skill-packs/mount.js');
    await writeCodexPackBlock(codexHome, null);
  });
}

function mergeSkillNames(disabled: readonly string[], hidden: readonly string[]): string[] {
  return [...new Set([...disabled, ...hidden])];
}

/** NFR-2: a Deft error removes the env file and leaves the launch as it would be without Deft. */
async function applyDeftFailOpen(
  envFile: string,
  apply: (envFile: string) => Promise<DeftLaunchResult>,
): Promise<DeftLaunchResult> {
  try {
    const result = await apply(envFile);
    for (const warning of result.warnings) console.error(warning);
    if (result.provenance) console.error(result.provenance);
    return result;
  } catch (error) {
    console.error(`[launcher] WARNING: deft integration not applied: ${error instanceof Error ? error.message : String(error)}`);
    const { rm } = await import('node:fs/promises');
    await rm(envFile, { force: true }).catch(() => undefined);
    return { hideSkills: [], deny: [], provenance: '', warnings: [] };
  }
}

async function applyPacksFailOpen(apply: () => Promise<string[]>, clear: () => Promise<void>): Promise<void> {
  try {
    for (const warning of await apply()) console.error(warning);
  } catch (error) {
    console.error(`[launcher] WARNING: skill packs not applied: ${error instanceof Error ? error.message : String(error)}`);
    await clear().catch(() => undefined);
  }
}

// ── pan skills pack (PAN-4334) ──────────────────────────────────────────

async function failOnPackError(error: unknown): Promise<never> {
  const { PackSourceError } = await import('../../lib/skill-packs/sources.js');
  if (error instanceof PackSourceError) {
    console.error(chalk.red(error.message));
    process.exit(1);
  }
  throw error;
}

const short = (commit: string): string => commit.slice(0, 7);
const listOrNone = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : 'none');

function printPackPreview(preview: PackPreview, notAppliedLabels: NotAppliedLabels): void {
  const { manifest } = preview;
  const optIn = manifest.skills.filter(skill => skill.optIn).map(skill => skill.name);
  const executables = manifest.capabilities.executables;
  const rows: Array<[string, string]> = [
    ['Source', `${preview.url} @ ${preview.ref} (${short(preview.commit)})`],
    ['Adapter', preview.adapter],
    ['License', manifest.license ?? 'unknown'],
    ['Skills', `${manifest.skills.length}${optIn.length > 0 ? ` (${optIn.length} opt-in: ${optIn.join(', ')})` : ''}`],
    ['Executables', executables.length > 3 ? `${executables.slice(0, 3).join(', ')}, …` : listOrNone(executables)],
    ['Not applied', listOrNone(notAppliedLabels(manifest.capabilities))],
  ];
  if (preview.diff && preview.previousCommit) {
    rows.push(
      ['Previous', short(preview.previousCommit)],
      ['Added', listOrNone(preview.diff.added)],
      ['Removed', listOrNone(preview.diff.removed)],
      ['Changed', listOrNone(preview.diff.changed)],
      ['New', listOrNone(preview.diff.newCapabilities)],
    );
  }
  console.log(chalk.bold(`Pack ${preview.id}`));
  for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
}

/** PD-10: `--yes` trusts; a TTY asks; anything else writes nothing. */
async function packConfirm(yes: boolean | undefined, note?: string): Promise<(preview: PackPreview) => Promise<boolean>> {
  const { notAppliedLabels } = await import('../../lib/skill-packs/adapters.js');
  return async preview => {
    printPackPreview(preview, notAppliedLabels);
    if (note) console.log(note);
    if (yes) return true;
    if (!process.stdin.isTTY) {
      console.log(`Not written: re-run with --yes to trust ${short(preview.commit)}.`);
      return false;
    }
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question('Trust this commit? [y/N] ')).trim());
    } finally {
      rl.close();
    }
  };
}

export async function skillsPackAddCommand(id: string, url: string, options: PackAddOptions): Promise<void> {
  if (
    options.adapter !== undefined &&
    options.adapter !== 'plain' &&
    options.adapter !== 'claude-plugin' &&
    options.adapter !== 'deft-readonly'
  ) {
    console.error(chalk.red('--adapter must be plain, claude-plugin, or deft-readonly'));
    process.exit(1);
  }
  const [{ addPack }, { CORE_SKILLS }] = await Promise.all([
    import('../../lib/skill-packs/sources.js'),
    import('../../lib/skill-overrides/resolve.js'),
  ]);
  const note = `Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack ${id} on`;
  const confirm = await packConfirm(options.yes, note);
  let result;
  try {
    result = await addPack(
      { id, url, ref: options.ref, ...(options.adapter ? { adapter: options.adapter } : {}), reservedIds: CORE_SKILLS },
      confirm,
    );
  } catch (error) {
    return failOnPackError(error);
  }
  if (!result.written) process.exit(1);
  console.log(`Trusted ${id} @ ${short(result.preview.commit)}.`);
}

export async function skillsPackUpdateCommand(id: string, options: PackUpdateOptions): Promise<void> {
  const { updatePack } = await import('../../lib/skill-packs/sources.js');
  let asked = false;
  const confirm = await packConfirm(options.yes);
  let result;
  try {
    result = await updatePack(id, options.ref ? { ref: options.ref } : {}, async preview => {
      asked = true;
      return confirm(preview);
    });
  } catch (error) {
    return failOnPackError(error);
  }
  if (!asked) {
    console.log(`${id} is up to date at ${result.preview.ref} (${short(result.preview.commit)}).`);
    return;
  }
  if (!result.written) process.exit(1);
  console.log(`Trusted ${id} @ ${short(result.preview.commit)}.`);
}

export async function skillsPackListCommand(options: PackListOptions): Promise<void> {
  const [{ packUpdateAvailable }, { listPackCatalog }, { notAppliedLabels, KNOWN_PACKS }] = await Promise.all([
    import('../../lib/skill-packs/sources.js'),
    import('../../lib/skill-overrides/catalog.js'),
    import('../../lib/skill-packs/adapters.js'),
  ]);
  const catalog = await listPackCatalog();
  const rows = await Promise.all(catalog.map(async pack => ({
    id: pack.id,
    url: pack.url,
    ref: pack.ref,
    commit: pack.commit,
    adapter: pack.adapter,
    cached: pack.cached,
    license: pack.manifest?.license ?? null,
    skills: pack.manifest?.skills.length ?? 0,
    notApplied: pack.manifest ? notAppliedLabels(pack.manifest.capabilities) : [],
    ...(options.offline ? {} : { updateAvailable: await packUpdateAvailable(pack) }),
  })));
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    const url = KNOWN_PACKS['mattpocock']?.url;
    console.log(`No skill packs. Add one with: pan skills pack add mattpocock ${url} --ref v1.2.3`);
    return;
  }
  console.log(chalk.bold(`\nSkill packs (${rows.length})\n`));
  for (const row of rows) {
    const update = 'updateAvailable' in row && row.updateAvailable ? `  update available: ${short(row.updateAvailable)}` : '';
    console.log(`${chalk.bold(row.id)}  ${row.url} @ ${row.ref} (${short(row.commit)})${update}`);
    console.log(chalk.dim(
      `  cached ${row.cached ? 'yes' : 'no'} · license ${row.license ?? 'unknown'} · ${row.skills} skills · Not applied: ${listOrNone(row.notApplied)}`,
    ));
  }
}

export async function skillsPackRemoveCommand(id: string): Promise<void> {
  const [{ removePack }, { listLowerLevelPackOverrides }] = await Promise.all([
    import('../../lib/skill-packs/sources.js'),
    import('../../lib/skill-overrides/store.js'),
  ]);
  let result;
  try {
    result = await removePack(id);
  } catch (error) {
    return failOnPackError(error);
  }
  if (!result.removed) {
    console.error(chalk.red(`pack ${id} is not registered`));
    process.exit(1);
  }
  console.log(`Removed pack ${id} and its cache.`);
  const below = (await listLowerLevelPackOverrides())[id];
  const remaining = below ? below.projects.length + below.issues.length : 0;
  if (remaining > 0) {
    console.log(`${remaining} project or issue toggle(s) for ${id} remain; they do nothing unless ${id} is added again.`);
  }
}

export async function skillsPackSyncCommand(id: string | undefined): Promise<void> {
  const { listPacks, syncPack } = await import('../../lib/skill-packs/sources.js');
  const ids = id ? [id] : (await listPacks()).map(entry => entry.id);
  let failed = false;
  for (const packId of ids) {
    try {
      const { commit } = await syncPack(packId);
      console.log(`${packId}: cached ${short(commit)}`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(chalk.red(error.message));
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

export async function skillsPackGcCommand(options: PackGcOptions): Promise<void> {
  const days = options.maxAgeDays === undefined ? 7 : Number(options.maxAgeDays);
  if (!Number.isFinite(days) || days < 0) {
    console.error(chalk.red('--max-age-days must be a number of days, 0 or more'));
    process.exit(1);
  }
  const { gcMounts } = await import('../../lib/skill-packs/mount.js');
  const { removedMounts, removedLinks } = await gcMounts({ maxAgeMs: days * 24 * 60 * 60 * 1000 });
  console.log(`Removed ${removedMounts.length} mount(s) and ${removedLinks.length} dangling launch link(s).`);
}

// ── pan skills pack sageox (PAN-2444) ───────────────────────────────────

export async function skillsPackSageoxStatusCommand(options: SageoxStatusOptions): Promise<void> {
  const [{ listSageoxUploads }, { loadSkillOverrideLayers }, { resolvePackToggle }, { getPack }] = await Promise.all([
    import('../../lib/sageox/config.js'),
    import('../../lib/skill-overrides/store.js'),
    import('../../lib/skill-overrides/resolve.js'),
    import('../../lib/skill-packs/sources.js'),
  ]);
  const uploads = await listSageoxUploads();
  if (options.project && !uploads.some(row => row.projectKey === options.project)) {
    console.error(chalk.red(`unknown project: ${options.project}`));
    process.exit(1);
  }
  const selected = options.project ? uploads.filter(row => row.projectKey === options.project) : uploads;
  const registered = (await getPack('sageox')) !== null;
  const projects = await Promise.all(selected.map(async ({ projectKey, upload }) => {
    const pack = resolvePackToggle('sageox', await loadSkillOverrideLayers({ projectKey }));
    return { project: projectKey, pack: pack.enabled ? 'on' : 'off', packSource: pack.source, upload };
  }));
  if (options.json) {
    console.log(JSON.stringify({ registered, projects }, null, 2));
    return;
  }
  if (!registered) console.log(chalk.yellow('The sageox pack is not registered. Add it with: pan skills pack add sageox https://github.com/eltmon/ox --ref <ref>'));
  const width = Math.max(7, ...projects.map(row => row.project.length));
  console.log(chalk.dim(`${'PROJECT'.padEnd(width)}  PACK  ${'SOURCE'.padEnd(7)}  UPLOAD`));
  for (const row of projects) {
    console.log(`${row.project.padEnd(width)}  ${row.pack.padEnd(4)}  ${row.packSource.padEnd(7)}  ${row.upload ? 'enabled' : 'disabled'}`);
  }
}

export async function skillsPackSageoxUploadCommand(state: string, options: SageoxUploadOptions): Promise<void> {
  if (state !== 'on' && state !== 'off') {
    console.error(chalk.red('state must be on or off'));
    process.exit(1);
  }
  const { setSageoxUpload, SageoxConfigError } = await import('../../lib/sageox/config.js');
  let result;
  try {
    result = await setSageoxUpload(options.project, state === 'on');
  } catch (error) {
    if (error instanceof SageoxConfigError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }
  const value = state === 'on' ? 'enabled' : 'disabled';
  console.log(`sageox upload: ${value} for project ${options.project}${result.changed ? '' : ' (unchanged)'}`);
  if (state === 'on') {
    console.log('Redacted session transcripts and metadata from this project will be uploaded to the SageOx cloud ledger when the sageox pack is on.');
  }
}

/** Registers `pan skills` and its subcommands. */
export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('List skills and set per-level on/off overrides');
  skills.command('list', { isDefault: true }).description('List skills with effective on/off state and its source')
    .option('--project <key>', 'Resolve for a project').option('--issue <id>', 'Resolve for an issue').option('--json', 'Output as JSON')
    .action(skillsListCommand);
  skills.command('set <args...>').description('Set a skill (<skill> <state>) or a pack (--pack <id> <state>) on, off, or inherit')
    .option('--project <key>', 'Project override').option('--issue <id>', 'Issue override')
    .option('--pack <id>', 'Set a whole skill pack instead of one skill')
    .action(skillsSetCommand);
  skills.command('launch-settings', { hidden: true }).description('Resolve skill overrides for a managed launch (used by launchers)')
    .requiredOption('--harness <harness>', 'claude-code or codex').requiredOption('--cwd <dir>', 'Launch working directory')
    .option('--issue <id>', 'Issue id').option('--codex-home <dir>', 'CODEX_HOME to write (codex)')
    .option('--plugin-link <path>', 'Per-launch skill pack plugin link to point at the mount (claude-code)')
    .action(skillsLaunchSettingsCommand);

  const pack = skills.command('pack').description('Register, update, and cache external skill packs pinned to a commit');
  pack.command('add <id> <url>').description('Register a git skill pack at the commit a ref resolves to (enables nothing)')
    .requiredOption('--ref <ref>', 'Tag or branch to pin').option('--adapter <adapter>', 'plain, claude-plugin, or deft-readonly')
    .option('--yes', 'Trust the resolved commit without asking').action(skillsPackAddCommand);
  pack.command('update <id>').description('Move a pack to the commit its ref (or --ref) now resolves to')
    .option('--ref <ref>', 'Switch to a different tag or branch').option('--yes', 'Trust the new commit without asking')
    .action(skillsPackUpdateCommand);
  pack.command('list').description('List registered skill packs')
    .option('--json', 'Output as JSON').option('--offline', 'Skip the update check (no network)')
    .action(skillsPackListCommand);
  pack.command('remove <id>').description('Unregister a pack, clear its global toggles, and delete its cache')
    .action(skillsPackRemoveCommand);
  pack.command('sync [id]').description('Re-fetch packs and extract their trusted commits (all packs when omitted)')
    .action(skillsPackSyncCommand);
  pack.command('gc').description('Remove unused skill pack mounts and dangling launch links')
    .option('--max-age-days <n>', 'Keep unused mounts younger than this', '7').action(skillsPackGcCommand);

  const sageox = pack.command('sageox').description('SageOx pack state and per-project upload opt-in (PAN-2444)');
  sageox.command('status').description('Show, per project, the sageox pack state and the upload state')
    .option('--project <key>', 'Only this project').option('--json', 'Output as JSON')
    .action(skillsPackSageoxStatusCommand);
  sageox.command('upload <state>').description('Turn SageOx uploads on or off for a project (off by default)')
    .requiredOption('--project <key>', 'Project key').action(skillsPackSageoxUploadCommand);

  registerSkillsDeftCommands(skills);
}

/**
 * `pan skills deft` — Deft Directive status and managed mode (PAN-3943).
 *
 *   pan skills deft status [--project <key>] [--json]
 *   pan skills deft enable --project <key> [--yes]
 *   pan skills deft disable --project <key>
 *
 * Status is derived on every run: detection, the deft pack registry entry,
 * the skill map, managed mode, and the ownership report. Enable stores only
 * the operator's decision and the digest of the report it printed. Nothing
 * here writes a project file or runs a Deft CLI.
 *
 * Registered from `./skills.ts`; like it, this module imports only Commander
 * types and chalk statically.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

interface StatusOptions { project?: string; json?: boolean }
interface EnableOptions { project: string; yes?: boolean }
interface DisableOptions { project: string }

const DEFT_PACK_URL = 'https://github.com/eltmon/directive';

async function projectPath(key: string): Promise<string> {
  const { listProjectsAsync } = await import('../../lib/projects.js');
  const project = (await listProjectsAsync()).find(entry => entry.key === key);
  if (!project) {
    console.error(chalk.red(`unknown project: ${key}`));
    process.exit(1);
  }
  return project.config.path;
}

/** Detection and the ownership report for a project root, computed the same way for status and enable. */
async function deftReport(root: string) {
  const [{ detectDirectiveProject }, { buildDeftCollisionReport }, { listSkillCatalog }] = await Promise.all([
    import('../../lib/deft/detect.js'),
    import('../../lib/deft/collisions.js'),
    import('../../lib/skill-overrides/catalog.js'),
  ]);
  const [detection, catalog] = await Promise.all([detectDirectiveProject(root), listSkillCatalog({ projectRoot: root })]);
  const report = buildDeftCollisionReport(detection, { overdeckSkillNames: catalog.map(entry => entry.name) });
  return { detection, report };
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
const listOrNone = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : 'none');

export async function skillsDeftStatusCommand(options: StatusOptions): Promise<void> {
  const [{ findRepoRoot }, { readDeftIntegration }, { listPacks }, deft] = await Promise.all([
    import('../../lib/deft/detect.js'),
    import('../../lib/deft/project-mode.js'),
    import('../../lib/skill-packs/sources.js'),
    import('../../lib/skill-packs/deft.js'),
  ]);
  const root = options.project ? await projectPath(options.project) : await findRepoRoot(process.cwd());
  const projectKey =
    options.project ?? (await (await import('../../lib/projects.js')).resolveProjectKeyForCwdAsync(root)) ?? undefined;
  const [{ detection, report }, pack, managed] = await Promise.all([
    deftReport(root),
    listPacks().then(entries => entries.find(entry => entry.id === 'deft') ?? null),
    projectKey ? readDeftIntegration(projectKey) : Promise.resolve(null),
  ]);
  const counts: Record<string, number> = {};
  for (const entry of Object.values(deft.DEFT_SKILL_MAP)) counts[entry.class] = (counts[entry.class] ?? 0) + 1;
  const skillMap = { verifiedAt: deft.DEFT_SKILL_MAP_VERIFIED_AT, counts, mounted: [...deft.DEFT_READONLY_SKILLS] };

  if (options.json) {
    console.log(JSON.stringify({ detection, pack, skillMap, managed, report }, null, 2));
    return;
  }

  const flag = detection.killSwitch.present
    ? `present (${detection.killSwitch.overdeckOwned ? 'written by Overdeck' : 'user-written'})`
    : 'absent';
  const supported =
    detection.killSwitchSupported === null ? 'unknown' : detection.killSwitchSupported ? 'supported' : 'not supported (< 0.92.0)';
  const rows: Array<[string, string]> = [
    ['Directive', yesNo(detection.isDirectiveProject)],
    ['Core version', detection.coreVersion ?? 'none'],
    ['Engine pin', detection.pinnedEngine ?? 'none'],
    ['Kill switch', `${supported}; flag ${flag}`],
    ['Opt-out', yesNo(detection.permanentOptOut)],
    ['AGENTS.md', detection.managedSection ? `managed section ${detection.managedSection}` : 'no managed section'],
    ['Agent hooks', listOrNone(detection.agentHookFiles)],
    ['Git hooks', `core.hooksPath ${detection.gitHooksPath ?? 'unset'}; .githooks/pre-commit ${detection.hasGithooksDir ? 'present' : 'absent'}`],
    ['Pointer', listOrNone(detection.pointerSkills)],
    ['xbrief', detection.xbriefProjectDefinition ? 'PROJECT-DEFINITION present' : 'no PROJECT-DEFINITION'],
    ['Pack', pack
      ? `${pack.url} @ ${pack.ref} (${pack.commit.slice(0, 12)})`
      : `not registered — pan skills pack add deft ${DEFT_PACK_URL} --ref <ref>`],
    ['Skill map', `${Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(', ')} ` +
      `(verified at ${skillMap.verifiedAt.repo} ${skillMap.verifiedAt.commit.slice(0, 7)}, ${skillMap.verifiedAt.describe})`],
    ['Mounted', skillMap.mounted.join(', ')],
    ['Managed', managed ? `managed since ${managed.enabled_at} (plan ${managed.plan_digest.slice(0, 12)})` : 'off'],
  ];
  console.log(chalk.bold(`Deft Directive — ${root}`));
  for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
  console.log('');
  console.log(report.text.trimEnd());
}

/** `--yes` accepts; a TTY asks; anything else writes nothing. */
async function confirmPlan(yes: boolean | undefined, digest: string): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log(`Not written: re-run with --yes to accept plan ${digest.slice(0, 12)}.`);
    return false;
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const accepted = /^y(es)?$/i.test((await rl.question('Enable managed mode with this ownership plan? [y/N] ')).trim());
    if (!accepted) console.log('Not written.');
    return accepted;
  } finally {
    rl.close();
  }
}

export async function skillsDeftEnableCommand(options: EnableOptions): Promise<void> {
  const root = await projectPath(options.project);
  const { detection, report } = await deftReport(root);
  if (!detection.isDirectiveProject) {
    console.error(chalk.red(`${options.project} is not a Directive project; Overdeck never runs directive init`));
    process.exit(1);
  }
  console.log(report.text.trimEnd());
  console.log('');
  if (!(await confirmPlan(options.yes, report.digest))) process.exit(1);
  const { enableDeftManaged } = await import('../../lib/deft/project-mode.js');
  await enableDeftManaged(options.project, report.digest);
  console.log(`Managed mode on for ${options.project} (plan ${report.digest.slice(0, 12)}); applies at next launch.`);
}

export async function skillsDeftDisableCommand(options: DisableOptions): Promise<void> {
  await projectPath(options.project);
  const { disableDeftManaged } = await import('../../lib/deft/project-mode.js');
  console.log(
    (await disableDeftManaged(options.project))
      ? `Managed mode off for ${options.project}; project files untouched.`
      : `Managed mode was not on for ${options.project}.`,
  );
}

/** Registers `pan skills deft` under the `skills` command. */
export function registerSkillsDeftCommands(skills: Command): void {
  const deft = skills.command('deft').description('Deft Directive detection, ownership report, and managed mode');
  deft.command('status').description('Show Directive detection, the deft pack, the skill map, managed mode, and the ownership report')
    .option('--project <key>', 'Registered project (default: the current repo)').option('--json', 'Output as JSON')
    .action(skillsDeftStatusCommand);
  deft.command('enable').description('Enable Deft managed mode for a Directive project after showing the ownership plan')
    .requiredOption('--project <key>', 'Registered project').option('--yes', 'Accept the printed plan without asking')
    .action(skillsDeftEnableCommand);
  deft.command('disable').description('Disable Deft managed mode; project files are untouched')
    .requiredOption('--project <key>', 'Registered project')
    .action(skillsDeftDisableCommand);
}

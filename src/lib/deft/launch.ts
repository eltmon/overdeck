/**
 * Deft launch resolution and apply (PAN-3943 WI-7).
 *
 * The launch step decides, per launch, what Overdeck exports to a Deft
 * Directive project:
 *
 *   Directive  deft toggle             managed  result
 *   no         any                     -        deny Deft CLIs when deft skills are mounted (Claude)
 *   yes        explicit off            any      kill switch: DEFT_DIRECTIVE_DISABLE=1, marked flag
 *                                               file in issue worktrees, pointer skills hidden
 *   yes        on or default           yes      DEFT_ORCHESTRATOR=overdeck
 *   yes        on or default           no       nothing; Deft runs as the user configured it
 *
 * Explicit off means the `deft` pack toggle resolves off at the issue or
 * project level; the default never disables a deposit. Apply writes only the
 * per-launch env file, the untracked marked flag file, and one line in the
 * repo's info/exclude. It never touches a tracked file or a flag it did not
 * write.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { listPacks } from '../skill-packs/sources.js';
import { issueIdFromWorkspacePath } from '../xbrief/io.js';
import { DEFT_FLAG_FILE, DEFT_FLAG_MARKER, detectDirectiveProject, findRepoRoot } from './detect.js';
import { readDeftIntegration } from './project-mode.js';

export { DEFT_FLAG_MARKER } from './detect.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;
const EXCLUDE_LINE = `/${DEFT_FLAG_FILE}`;

/** Deft's repo-mutating CLIs, denied to Claude when deft skills are mounted outside a Directive project. */
export const DEFT_CLI_DENY: readonly string[] = [
  'Bash(directive:*)',
  'Bash(deft:*)',
  'Bash(deft-hook:*)',
  'Bash(npx @deftai/directive:*)',
  'Bash(npm install @deftai/directive:*)',
  'Bash(npm i @deftai/directive:*)',
  'Bash(pnpm add @deftai/directive:*)',
  'Bash(git config core.hooksPath:*)',
];

export interface DeftLaunchPlan {
  /** The launch repo root is a Directive project. */
  directive: boolean;
  /** Explicit off in a Directive project. */
  killSwitch: boolean;
  /** killSwitch and the repo root is a `feature-<issue>` worktree. */
  writeFlag: boolean;
  /** Managed mode, Directive project, no kill switch. */
  orchestrator: boolean;
  /** Any deft/* skill mounted and not a Directive project. */
  denyCli: boolean;
  /** Pointer skill names to hide; the deposit's `deft-directive-*` skills under the kill switch. */
  hideSkills: string[];
  /** One `[launcher] deft:` line for stderr. */
  provenance: string;
}

export interface DeftLaunchContext {
  cwd: string;
  issueId?: string;
  projectKey?: string;
  deftSkillsMounted: boolean;
}

async function packProvenance(deftSkillsMounted: boolean): Promise<string> {
  if (!deftSkillsMounted) return 'pack off';
  const pack = (await listPacks()).find((entry) => entry.id === 'deft');
  return pack ? `pack ${pack.ref} (${pack.commit.slice(0, 12)})` : 'pack off';
}

export async function resolveDeftLaunch(ctx: DeftLaunchContext): Promise<DeftLaunchPlan> {
  const [{ loadSkillOverrideLayers }, { resolvePackToggle }] = await Promise.all([
    import('../skill-overrides/store.js'),
    import('../skill-overrides/resolve.js'),
  ]);
  const root = await findRepoRoot(ctx.cwd);
  const [layers, detection, managed, pack] = await Promise.all([
    loadSkillOverrideLayers({ projectKey: ctx.projectKey, issueId: ctx.issueId ?? issueIdFromWorkspacePath(root) ?? undefined }),
    detectDirectiveProject(root),
    ctx.projectKey ? readDeftIntegration(ctx.projectKey) : Promise.resolve(null),
    packProvenance(ctx.deftSkillsMounted),
  ]);
  const toggle = resolvePackToggle('deft', layers);
  const explicitOff = !toggle.enabled && (toggle.source === 'issue' || toggle.source === 'project');

  const directive = detection.isDirectiveProject;
  const killSwitch = directive && explicitOff;
  // The root, not the cwd: a polyrepo wrapper cwd resolves to the primary checkout, which never gets a flag.
  const writeFlag = killSwitch && issueIdFromWorkspacePath(root) !== null;
  const orchestrator = managed !== null && directive && !killSwitch;
  const denyCli = ctx.deftSkillsMounted && !directive;

  const engine = detection.pinnedEngine ?? detection.coreVersion;
  const project = directive ? `project directive${engine ? ` engine ${engine}` : ''}` : 'project not directive';
  const state = killSwitch ? 'kill switch' : orchestrator ? 'managed' : directive ? 'untouched' : 'read-only';
  return {
    directive,
    killSwitch,
    writeFlag,
    orchestrator,
    denyCli,
    hideSkills: killSwitch ? detection.pointerSkills : [],
    provenance: `[launcher] deft: ${pack}; ${project}; ${state}`,
  };
}

/** Exit status of a git command: a number for a normal exit; throws on timeout or spawn failure. */
async function gitStatus(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { code: 0, stdout };
  } catch (error) {
    const code = (error as { code?: unknown; killed?: boolean }).code;
    if (typeof code === 'number' && !(error as { killed?: boolean }).killed) return { code, stdout: '' };
    throw error;
  }
}

/** Whether git tracks the flag: 0 tracked, 1 untracked; anything else is an error. */
async function isFlagTracked(root: string): Promise<boolean> {
  const { code } = await gitStatus(root, ['ls-files', '--error-unmatch', '--', DEFT_FLAG_FILE]);
  if (code === 0) return true;
  if (code === 1) return false;
  throw new Error(`git ls-files exited ${code} in ${root}`);
}

/** Make sure git ignores the flag, appending to info/exclude when nothing ignores it yet. */
async function ensureFlagIgnored(root: string): Promise<void> {
  const { code } = await gitStatus(root, ['check-ignore', '-q', DEFT_FLAG_FILE]);
  if (code === 0) return;
  if (code !== 1) throw new Error(`git check-ignore exited ${code} in ${root}`);
  const gitPath = await gitStatus(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (gitPath.code !== 0 || !gitPath.stdout.trim()) throw new Error(`cannot locate info/exclude in ${root}`);
  const exclude = resolve(root, gitPath.stdout.trim());
  const existing = await readTextOrNull(exclude);
  if (existing?.split(/\r?\n/).includes(EXCLUDE_LINE)) return;
  await mkdir(dirname(exclude), { recursive: true });
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(exclude, `${existing ?? ''}${prefix}${EXCLUDE_LINE}\n`, 'utf8');
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Write or remove the per-launch env file and the marked flag file for a
 * plan. Returns warnings for the launcher to print. Errors propagate so the
 * caller can fail open.
 */
export async function applyDeftLaunch(plan: DeftLaunchPlan, root: string, envFile: string): Promise<string[]> {
  const warnings: string[] = [];
  const lines = [
    ...(plan.killSwitch ? ['DEFT_DIRECTIVE_DISABLE=1'] : []),
    ...(plan.orchestrator ? ['DEFT_ORCHESTRATOR=overdeck'] : []),
  ];
  if (lines.length > 0) {
    await mkdir(dirname(envFile), { recursive: true });
    await writeFile(envFile, lines.map((line) => `${line}\n`).join(''), { mode: 0o600 });
  } else {
    await removeIfPresent(envFile);
  }

  const flagPath = join(root, DEFT_FLAG_FILE);
  const flag = await readTextOrNull(flagPath);
  if (plan.writeFlag && flag === null) {
    if (await isFlagTracked(root)) {
      warnings.push(`[launcher] WARNING: deft: ${DEFT_FLAG_FILE} is tracked in ${root}; flag not written`);
    } else {
      const issue = issueIdFromWorkspacePath(root) ?? '<ISSUE>';
      await writeFile(flagPath, `${DEFT_FLAG_MARKER}\n# Remove with: pan skills set --pack deft inherit --issue ${issue}\n`, 'utf8');
      await ensureFlagIgnored(root);
    }
  } else if (!plan.killSwitch && flag !== null && flag.split(/\r?\n/, 1)[0] === DEFT_FLAG_MARKER) {
    if (await isFlagTracked(root)) {
      warnings.push(`[launcher] WARNING: deft: ${DEFT_FLAG_FILE} is tracked in ${root}; flag not removed`);
    } else {
      await unlink(flagPath);
    }
  }
  return warnings;
}

/**
 * `~/.config/herdr/config.toml`: `[session] resume_agents_on_restore = false`
 * (PAN-3956 W6, FR-4, D3).
 *
 * With the Herdr default (`true`), a Herdr server restart relaunches every
 * agent pane into its native resume — ignoring Overdeck's paused, stopped,
 * troubled and boot-no-resume gates. Overdeck owns resume, so the key must be
 * `false`.
 *
 * The file is the user's and is shared by every Herdr session. The edit itself
 * is `config-edit.ts` (line by line, verified by parsing); here it is written
 * atomically through any symlink with the file's mode kept, checked with
 * `herdr config check`, and a running server is told to `server reload-config`
 * (never restarted). A failed reload is reported, not hidden.
 */

import { chmod, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { parse as parseToml } from '@iarna/toml';

import { DESIRED_LINE, RESUME_KEY, planResumeAgentsOnRestore } from './config-edit.js';
import { defaultHerdrExec, type HerdrExec } from './status.js';

export { DESIRED_LINE, RESUME_KEY, planResumeAgentsOnRestore } from './config-edit.js';

/** The edit could not be made safely; nothing was written. */
export class HerdrConfigEditError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly hint: string,
  ) {
    super(`Cannot safely edit ${path}: ${reason}. By hand: ${hint} in ${path}, then run \`pan sync\``);
    this.name = 'HerdrConfigEditError';
  }
}

/**
 * The Herdr config file, resolved the way Herdr resolves it:
 * `HERDR_CONFIG_PATH` first, then `$XDG_CONFIG_HOME/herdr/config.toml`, then
 * `~/.config/herdr/config.toml`.
 */
export function herdrConfigPath(deps: {
  homeDir?: string;
  configHome?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): string {
  const env = deps.env ?? process.env;
  const explicit = env.HERDR_CONFIG_PATH?.trim();
  if (explicit) return resolve(explicit);
  const configHome = deps.configHome
    || env.XDG_CONFIG_HOME
    || join(deps.homeDir ?? homedir(), '.config');
  return join(configHome, 'herdr', 'config.toml');
}

/**
 * Pure: the text with `[session] resume_agents_on_restore = false`, touching
 * nothing else. Returns the input unchanged when it already says so. Throws
 * `HerdrConfigEditError` when no safe edit exists.
 */
export function setResumeAgentsOnRestore(text: string): string {
  const plan = planResumeAgentsOnRestore(text);
  if (plan.kind === 'unchanged') return text;
  if (plan.kind === 'edited') return plan.text;
  throw new HerdrConfigEditError('config.toml', plan.reason, plan.hint);
}

/** True only when the file parses and says `[session] resume_agents_on_restore = false`. */
export async function herdrConfigDisablesResume(
  path: string,
  read: (path: string) => Promise<string> = (p) => readFile(p, 'utf-8'),
): Promise<boolean> {
  try {
    const doc = parseToml(await read(path)) as { session?: Record<string, unknown> };
    return doc.session?.[RESUME_KEY] === false;
  } catch {
    return false;
  }
}

export interface EnsureHerdrConfigDeps {
  readonly binary: string;
  readonly session: string;
  readonly serverRunning: boolean;
  readonly path?: string;
  readonly exec?: HerdrExec;
  readonly readFile?: (path: string) => Promise<string>;
  readonly writeFile?: (path: string, text: string) => Promise<void>;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly unlink?: (path: string) => Promise<void>;
  readonly mkdir?: (path: string) => Promise<void>;
  /** Resolves symlinks so the link's target is edited, not replaced. */
  readonly realpath?: (path: string) => Promise<string>;
  /** Permission bits of an existing file, carried onto the rewritten one. */
  readonly fileMode?: (path: string) => Promise<number | null>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
}

export interface EnsureHerdrConfigResult {
  readonly changed: boolean;
  readonly path: string;
  /** The file was written but a running server did not reload it. */
  readonly reloadWarning?: string;
}

async function defaultFileMode(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch {
    return null;
  }
}

async function writeAtomically(
  path: string,
  text: string,
  mode: number | null,
  deps: EnsureHerdrConfigDeps,
): Promise<void> {
  const write = deps.writeFile ?? ((p: string, t: string) => writeFile(p, t, 'utf-8'));
  const move = deps.rename ?? rename;
  const makeDir = deps.mkdir ?? (async (p: string) => { await mkdir(p, { recursive: true }); });
  await makeDir(dirname(path));
  // Per-process tmp name: two passes (a manual `pan sync` beside the detached
  // one) never write the same tmp file.
  const tmp = `${path}.${process.pid}.tmp`;
  await write(tmp, text);
  if (mode !== null) await (deps.chmod ?? chmod)(tmp, mode);
  await move(tmp, path);
}

function lastLine(result: { stdout: string; stderr: string; exitCode: number }): string {
  return (result.stderr || result.stdout).trim().split('\n').pop() || `exit ${result.exitCode}`;
}

/**
 * Make the Herdr config say `resume_agents_on_restore = false`. Writes nothing
 * when it already does. Throws `HerdrConfigEditError` (writing nothing) when
 * no safe edit exists. Restores the previous text and throws when
 * `herdr config check` rejects the result. Reloads a running server's config
 * and reports a failed reload as `reloadWarning` — the file is still written.
 */
export async function ensureHerdrConfig(deps: EnsureHerdrConfigDeps): Promise<EnsureHerdrConfigResult> {
  const path = deps.path ?? herdrConfigPath();
  const exec = deps.exec ?? defaultHerdrExec;
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf-8'));

  let previous: string | null;
  try {
    previous = await read(path);
  } catch {
    previous = null;
  }
  const plan = planResumeAgentsOnRestore(previous ?? '');
  if (plan.kind === 'refused') throw new HerdrConfigEditError(path, plan.reason, plan.hint);
  if (plan.kind === 'unchanged' && previous !== null) return { changed: false, path };
  const next = plan.kind === 'edited' ? plan.text : `[session]\n${DESIRED_LINE}\n`;

  // Edit a symlink's target, so a dotfiles-managed config stays a link.
  const target = previous === null ? path : await (deps.realpath ?? realpath)(path).catch(() => path);
  const mode = previous === null ? null : await (deps.fileMode ?? defaultFileMode)(target);
  await writeAtomically(target, next, mode, deps);

  const check = await exec(deps.binary, ['config', 'check']).catch((error: unknown) => ({
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: -1,
  }));
  if (check.exitCode !== 0) {
    if (previous === null) {
      await (deps.unlink ?? unlink)(path).catch(() => {});
    } else {
      await writeAtomically(target, previous, mode, deps);
    }
    throw new Error(
      `herdr config check rejected ${path} (exit ${check.exitCode}): `
      + `${(check.stderr || check.stdout).trim() || 'no diagnostics'}. The previous file was restored.`,
    );
  }

  if (deps.serverRunning) {
    const reload = await exec(deps.binary, ['--session', deps.session, 'server', 'reload-config']).catch(
      (error: unknown) => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: -1 }),
    );
    if (reload.exitCode !== 0) {
      return {
        changed: true,
        path,
        reloadWarning: `Wrote ${DESIRED_LINE} to ${path}, but \`herdr --session ${deps.session} server reload-config\` `
          + `failed (${lastLine(reload)}); the running '${deps.session}' server keeps its old setting until its `
          + 'next restart',
      };
    }
  }
  return { changed: true, path };
}

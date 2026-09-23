/**
 * `~/.config/herdr/config.toml`: `[session] resume_agents_on_restore = false`
 * (PAN-3956 W6, FR-4, D3).
 *
 * With the Herdr default (`true`), a Herdr server restart relaunches every
 * agent pane into its native resume — ignoring Overdeck's paused, stopped,
 * troubled and boot-no-resume gates. Overdeck owns resume, so the key must be
 * `false`.
 *
 * The file is the user's and is shared by every Herdr session, so it is edited
 * line by line: comments, other sections and user keys survive byte-for-byte.
 * The result is verified by parsing it and by `herdr config check`; a running
 * server is told to `server reload-config` (never restarted).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { parse as parseToml } from '@iarna/toml';

import { defaultHerdrExec, type HerdrExec } from './status.js';

export const RESUME_KEY = 'resume_agents_on_restore';
const DESIRED_LINE = `${RESUME_KEY} = false`;

const SESSION_HEADER = /^\s*\[session\]\s*(#.*)?$/;
const ANY_HEADER = /^\s*\[/;
const KEY_LINE = /^\s*#?\s*resume_agents_on_restore\s*=/;
const LIVE_KEY_LINE = /^\s*resume_agents_on_restore\s*=/;
const LIVE_FALSE_LINE = /^\s*resume_agents_on_restore\s*=\s*false\s*(#.*)?$/;

/** `~/.config/herdr/config.toml`, honoring XDG_CONFIG_HOME exactly as `herdrSocketPath` does. */
export function herdrConfigPath(deps: { homeDir?: string; configHome?: string } = {}): string {
  const configHome = deps.configHome
    ?? process.env.XDG_CONFIG_HOME
    ?? join(deps.homeDir ?? homedir(), '.config');
  return join(configHome, 'herdr', 'config.toml');
}

/** The `[session]` section as line indices: header line and end (exclusive). */
function findSessionSection(lines: readonly string[]): { header: number; end: number } | null {
  const header = lines.findIndex((line) => SESSION_HEADER.test(line));
  if (header < 0) return null;
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i++) {
    if (ANY_HEADER.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return { header, end };
}

/**
 * Pure: the text with `[session] resume_agents_on_restore = false`, touching
 * nothing else. Returns the input unchanged when it already says so.
 */
export function setResumeAgentsOnRestore(text: string): string {
  if (text.trim() === '') return `[session]\n${DESIRED_LINE}\n`;

  const lines = text.split('\n');
  const section = findSessionSection(lines);
  if (!section) {
    const base = text.endsWith('\n') ? text : `${text}\n`;
    return `${base}\n[session]\n${DESIRED_LINE}\n`;
  }

  const body = lines.slice(section.header + 1, section.end);
  const liveIndex = body.findIndex((line) => LIVE_KEY_LINE.test(line));
  if (liveIndex >= 0) {
    if (LIVE_FALSE_LINE.test(body[liveIndex] as string)) return text;
    lines[section.header + 1 + liveIndex] = DESIRED_LINE;
    return lines.join('\n');
  }
  const commentedIndex = body.findIndex((line) => KEY_LINE.test(line));
  if (commentedIndex >= 0) {
    lines[section.header + 1 + commentedIndex] = DESIRED_LINE;
    return lines.join('\n');
  }
  lines.splice(section.header + 1, 0, DESIRED_LINE);
  return lines.join('\n');
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
}

async function writeAtomically(
  path: string,
  text: string,
  deps: EnsureHerdrConfigDeps,
): Promise<void> {
  const write = deps.writeFile ?? ((p: string, t: string) => writeFile(p, t, 'utf-8'));
  const move = deps.rename ?? rename;
  const makeDir = deps.mkdir ?? (async (p: string) => { await mkdir(p, { recursive: true }); });
  await makeDir(dirname(path));
  const tmp = `${path}.tmp`;
  await write(tmp, text);
  await move(tmp, path);
}

/**
 * Make the Herdr config say `resume_agents_on_restore = false`. Writes nothing
 * when it already does. Restores the previous text and throws when
 * `herdr config check` rejects the result. Reloads a running server's config.
 */
export async function ensureHerdrConfig(deps: EnsureHerdrConfigDeps): Promise<{ changed: boolean; path: string }> {
  const path = deps.path ?? herdrConfigPath();
  const exec = deps.exec ?? defaultHerdrExec;
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf-8'));

  let previous: string | null;
  try {
    previous = await read(path);
  } catch {
    previous = null;
  }
  const current = previous ?? '';
  const next = setResumeAgentsOnRestore(current);
  if (next === current && previous !== null) return { changed: false, path };

  const parsed = parseToml(next) as { session?: Record<string, unknown> };
  if (parsed.session?.[RESUME_KEY] !== false) {
    throw new Error(`Refusing to write ${path}: the edited file does not parse to [session] ${DESIRED_LINE}.`);
  }

  await writeAtomically(path, next, deps);

  const check = await exec(deps.binary, ['config', 'check']).catch((error: unknown) => ({
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: -1,
  }));
  if (check.exitCode !== 0) {
    if (previous === null) {
      await (deps.unlink ?? unlink)(path).catch(() => {});
    } else {
      await writeAtomically(path, previous, deps);
    }
    throw new Error(
      `herdr config check rejected ${path} (exit ${check.exitCode}): `
      + `${(check.stderr || check.stdout).trim() || 'no diagnostics'}. The previous file was restored.`,
    );
  }

  if (deps.serverRunning) {
    await exec(deps.binary, ['--session', deps.session, 'server', 'reload-config']);
  }
  return { changed: true, path };
}

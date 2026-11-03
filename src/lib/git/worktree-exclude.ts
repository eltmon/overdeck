/**
 * Hide paths from `git status` with owner blocks in an exclude file
 * (PAN-4852 WI-9). Deft and SageOx share this module, because a worktree has
 * only one `core.excludesFile`.
 *
 * Two scopes, chosen by where `root` lives:
 * - **worktree** (a linked worktree): `<gitdir>/info/overdeck-exclude`, set as
 *   the worktree's `core.excludesFile` (`extensions.worktreeConfig`). A
 *   worktree value replaces the global excludes file, so the file starts with
 *   a fresh copy of it, then holds each owner's block.
 * - **common** (the primary checkout): a block in `info/exclude`. That file
 *   lives in the common git dir, so the block hides the paths in every
 *   worktree of the repository. Every other line is kept byte for byte.
 *
 * A block is `# overdeck:<owner> begin`, one pattern per line, then
 * `# overdeck:<owner> end`. Patterns are written as given.
 *
 * Migration: a Deft install from before PAN-4852 wrote its own
 * `<gitdir>/info/overdeck-deft-exclude` and pointed the worktree at it. The
 * first rebuild here carries that file's Deft patterns into a `deft` block, so
 * repointing `core.excludesFile` never un-hides them.
 *
 * Async only: every git call goes through execFile.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ExcludeOwner = 'deft' | 'sageox';

export interface ExcludeTarget {
  scope: 'worktree' | 'common';
  /** Absolute path of the exclude file. */
  file: string;
}

/** The worktree exclude file's name under `<gitdir>/info/`. */
export const WORKTREE_EXCLUDE_NAME = 'overdeck-exclude';
/** The pre-PAN-4852 Deft-only exclude file under `<gitdir>/info/`. */
const LEGACY_DEFT_EXCLUDE_NAME = 'overdeck-deft-exclude';
const LEGACY_DEFT_HEADER = /^# overdeck:deft \S+$/;
const GLOBAL_COPY_HEADER = '# overdeck: copy of the global excludes file';
const BLOCK_LINE = /^# overdeck:([a-z]+) (begin|end)$/;

async function git(root: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd: root })).stdout;
}

/** `git config <scope> --get <key>`, or null when unset. */
async function configGet(root: string, scope: string, key: string): Promise<string | null> {
  try {
    return (await git(root, ['config', scope, '--get', key])).trim() || null;
  } catch {
    return null;
  }
}

export async function excludeTarget(root: string): Promise<ExcludeTarget> {
  const [gitDirRaw = '', commonDirRaw = ''] = (await git(root, ['rev-parse', '--git-dir', '--git-common-dir'])).split('\n');
  const gitDir = resolve(root, gitDirRaw.trim());
  const commonDir = resolve(root, commonDirRaw.trim());
  if (gitDir !== commonDir) return { scope: 'worktree', file: join(gitDir, 'info', WORKTREE_EXCLUDE_NAME) };
  return { scope: 'common', file: resolve(root, (await git(root, ['rev-parse', '--git-path', 'info/exclude'])).trim()) };
}

// ── block text ───────────────────────────────────────────────────────────

const begin = (owner: string): string => `# overdeck:${owner} begin`;
const end = (owner: string): string => `# overdeck:${owner} end`;

interface Parsed {
  /** Lines outside every block, in order. */
  outside: string[];
  /** Each block's owner and patterns, in file order. */
  blocks: Array<{ owner: string; patterns: string[] }>;
}

/** Split exclude text into lines outside blocks and owner blocks. An unterminated block runs to the end. */
function parse(text: string): Parsed {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const parsed: Parsed = { outside: [], blocks: [] };
  let open: { owner: string; patterns: string[] } | null = null;
  for (const line of lines) {
    const match = BLOCK_LINE.exec(line);
    if (open) {
      if (match && match[1] === open.owner && match[2] === 'end') open = null;
      else open.patterns.push(line);
      continue;
    }
    if (match && match[2] === 'begin') {
      open = { owner: match[1] ?? '', patterns: [] };
      parsed.blocks.push(open);
      continue;
    }
    parsed.outside.push(line);
  }
  return parsed;
}

function blockLines(owner: string, patterns: readonly string[]): string[] {
  return [begin(owner), ...patterns, end(owner)];
}

/**
 * `text` with `owner`'s block replaced by `replacement` (dropped when null).
 * Every other line, and the final newline, stay as they were.
 */
function spliceBlock(text: string, owner: string, replacement: string[] | null): string {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (!inside && line === begin(owner)) {
      inside = true;
      if (replacement) lines.push(...replacement);
      continue;
    }
    if (inside) {
      if (line === end(owner)) inside = false;
      continue;
    }
    lines.push(line);
  }
  // An unterminated block swallowed the final newline.
  if (inside && lines.at(-1) !== '') lines.push('');
  return lines.join('\n');
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, file);
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

/**
 * The text of the excludes file git would read without a worktree value:
 * `core.excludesFile` from the local, global or system config, else
 * `$XDG_CONFIG_HOME/git/ignore`, else `~/.config/git/ignore`. Empty when the
 * file is missing or is `own` itself.
 */
async function effectiveGlobalExcludes(root: string, own: string): Promise<string> {
  let configured: string | null = null;
  for (const scope of ['--local', '--global', '--system']) {
    configured = await configGet(root, scope, 'core.excludesFile');
    if (configured) break;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const path = configured
    ? resolve(root, expandHome(configured))
    : join(xdg ? xdg : join(homedir(), '.config'), 'git', 'ignore');
  if (path === own) return '';
  return (await readText(path)) ?? '';
}

/**
 * The Deft patterns of a pre-PAN-4852 install, when the worktree still points
 * at its legacy file: every line after its `# overdeck:deft <issue>` header.
 * Null when the worktree points elsewhere or the file has no header.
 */
async function legacyDeftPatterns(root: string, own: string): Promise<string[] | null> {
  const legacy = join(dirname(own), LEGACY_DEFT_EXCLUDE_NAME);
  const configured = await configGet(root, '--worktree', 'core.excludesFile');
  if (!configured || resolve(root, expandHome(configured)) !== legacy) return null;
  const lines = ((await readText(legacy)) ?? '').split('\n');
  const header = lines.findIndex(line => LEGACY_DEFT_HEADER.test(line));
  if (header < 0) return null;
  return lines.slice(header + 1).filter(line => line.trim() !== '');
}

// ── the API ──────────────────────────────────────────────────────────────

/**
 * Replace or append `owner`'s block. Worktree scope rebuilds the file from a
 * fresh copy of the global excludes plus every owner block, then points the
 * worktree's `core.excludesFile` at it.
 */
export async function setExcludeBlock(root: string, owner: ExcludeOwner, patterns: readonly string[]): Promise<ExcludeTarget> {
  const target = await excludeTarget(root);
  const current = (await readText(target.file)) ?? '';
  const parsed = parse(current);
  const index = parsed.blocks.findIndex(block => block.owner === owner);

  if (target.scope === 'common') {
    // Keep every line outside the block; replace the block in place, or append it.
    const block = blockLines(owner, patterns);
    const prefix = current === '' || current.endsWith('\n') ? current : `${current}\n`;
    await writeAtomic(target.file, index >= 0 ? spliceBlock(current, owner, block) : `${prefix}${block.join('\n')}\n`);
    return target;
  }

  await git(root, ['config', 'extensions.worktreeConfig', 'true']);
  const blocks = parsed.blocks.map(block => (block.owner === owner ? { owner, patterns: [...patterns] } : block));
  if (owner !== 'deft' && !blocks.some(block => block.owner === 'deft')) {
    const legacy = await legacyDeftPatterns(root, target.file);
    if (legacy) blocks.push({ owner: 'deft', patterns: legacy });
  }
  if (index < 0) blocks.push({ owner, patterns: [...patterns] });
  const globalExcludes = (await effectiveGlobalExcludes(root, target.file)).trimEnd();
  const lines = [
    ...(globalExcludes ? [GLOBAL_COPY_HEADER, globalExcludes] : []),
    ...blocks.flatMap(block => blockLines(block.owner, block.patterns)),
  ];
  await writeAtomic(target.file, `${lines.join('\n')}\n`);
  await git(root, ['config', '--worktree', 'core.excludesFile', target.file]);
  return target;
}

/** `owner`'s patterns, or null when its block is absent. */
export async function readExcludeBlock(root: string, owner: ExcludeOwner): Promise<string[] | null> {
  const target = await excludeTarget(root);
  const text = await readText(target.file);
  if (text === null) return null;
  return parse(text).blocks.find(block => block.owner === owner)?.patterns ?? null;
}

/**
 * Drop `owner`'s block. Worktree scope: when no owner block remains, unset
 * the worktree's `core.excludesFile` (only when it points at this file) and
 * delete the file; `extensions.worktreeConfig` stays on. Returns whether the
 * block was present.
 */
export async function removeExcludeBlock(root: string, owner: ExcludeOwner): Promise<boolean> {
  const target = await excludeTarget(root);
  const current = await readText(target.file);
  if (current === null) return false;
  const parsed = parse(current);
  const present = parsed.blocks.some(block => block.owner === owner);

  if (target.scope === 'common') {
    if (present) await writeAtomic(target.file, spliceBlock(current, owner, null));
    return present;
  }

  const remaining = parsed.blocks.filter(block => block.owner !== owner);
  if (remaining.length > 0) {
    if (!present) return false;
    const lines = [...parsed.outside, ...remaining.flatMap(block => blockLines(block.owner, block.patterns))];
    await writeAtomic(target.file, `${lines.join('\n')}\n`);
    return true;
  }

  if ((await configGet(root, '--worktree', 'core.excludesFile')) === target.file) {
    try {
      await git(root, ['config', '--worktree', '--unset', 'core.excludesFile']);
    } catch (error) {
      // Exit 5: the key was not set.
      if ((error as { code?: unknown }).code !== 5) throw error;
    }
  }
  await rm(target.file, { force: true });
  return present;
}

/**
 * The legacy `.pan/` ignore rule in project repos (PAN-3996).
 *
 * Before the Cut, Overdeck's own tooling wrote `.pan/` into project
 * `.gitignore` files. Since PAN-3917 planning artifacts live under `.pan/` in
 * the plan home and are committed, so that rule makes every planning commit
 * fail ("The following paths are ignored by one of your .gitignore files").
 *
 * This module answers one question for a repo: is `.pan/` ignored, and if so,
 * is the deciding rule Overdeck's legacy line — an exact `.pan/` or `.pan`
 * line in the repository's top-level `.gitignore`? Only that line is ever
 * edited. A rule from anywhere else (a nested `.gitignore`, `.git/info/exclude`,
 * `core.excludesFile`, a broader pattern) is reported with its source and left
 * alone: it is the operator's rule, not ours.
 *
 * Async git only — `pan doctor` and `migrate-plan-home` call it, and nothing
 * here may block a server event loop if it is ever reached from one.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The exact lines Overdeck wrote. Anything else is someone else's rule. */
const LEGACY_PAN_IGNORE_PATTERNS: readonly string[] = ['.pan/', '.pan'];

/**
 * Paths checked against the ignore rules: one per `.pan/` subtree the pipeline
 * commits into. They need not exist — `check-ignore` is pattern matching — and
 * a nested `.pan/.gitignore` still applies to them.
 */
const PAN_IGNORE_PROBES: readonly string[] = [
  'drafts',
  'specs',
  'continues',
  'orders',
  'notes',
  'backlog',
].map((dir) => `.pan/${dir}/__overdeck_ignore_probe__.md`);

/** Removing lines is bounded: a repo can carry the legacy line more than once, not forever. */
const MAX_LEGACY_REMOVALS = 8;

export type PanIgnoreStatus =
  /** The directory does not exist or is not inside a git work tree. */
  | { readonly kind: 'not-a-repo' }
  | { readonly kind: 'not-ignored'; readonly repoRoot: string }
  /** Overdeck's own legacy line decides: safe to remove. */
  | {
      readonly kind: 'legacy';
      readonly repoRoot: string;
      /** Absolute path of the top-level `.gitignore`. */
      readonly source: string;
      readonly line: number;
      readonly pattern: string;
    }
  /** Some other rule decides: report it, never edit it. */
  | {
      readonly kind: 'foreign';
      readonly repoRoot: string;
      /** Absolute path of the file holding the rule. */
      readonly source: string;
      readonly line: number;
      readonly pattern: string;
    };

/** A git command that failed for a reason this module did not expect. */
export class PlanHomeGitError extends Error {
  readonly _tag = 'PlanHomeGitError' as const;

  constructor(
    /** The git subcommand, e.g. `check-ignore` or `commit`. */
    readonly step: string,
    readonly cwd: string,
    /** First meaningful line of git's stderr (or the spawn error). */
    readonly detail: string,
  ) {
    super(`git ${step} failed in ${cwd}: ${detail}`);
    this.name = 'PlanHomeGitError';
  }
}

interface ExecFailure {
  code?: number | string;
  stderr?: string;
  message?: string;
}

function firstLine(error: unknown): string {
  const failure = (error ?? {}) as ExecFailure;
  const text = [failure.stderr, failure.message].find((value) => typeof value === 'string' && value.trim());
  const line = (text ?? String(error)).split('\n').map((l) => l.trim()).find(Boolean);
  return line ?? 'unknown error';
}

/** Run git, mapping any failure to a `PlanHomeGitError` that carries git's own reason. */
export async function runPlanHomeGit(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new PlanHomeGitError(args[0] ?? 'git', cwd, firstLine(error));
  }
}

async function repoToplevel(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    return stdout.trim() || null;
  } catch (error) {
    const detail = firstLine(error);
    if (/not a git repository/i.test(detail)) return null;
    throw new PlanHomeGitError('rev-parse', dir, detail);
  }
}

interface IgnoreRecord {
  source: string;
  line: number;
  pattern: string;
  path: string;
}

/** `check-ignore -v -z` records: `<source>\0<linenum>\0<pattern>\0<pathname>\0`. */
export function parseCheckIgnoreRecords(stdout: string): IgnoreRecord[] {
  const fields = stdout.split('\0');
  const records: IgnoreRecord[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, pattern, path] = fields.slice(i, i + 4);
    if (!source) continue; // a non-matching record (only with -n)
    records.push({ source, line: Number.parseInt(line, 10), pattern, path });
  }
  return records;
}

/**
 * Whether `.pan/` is ignored in the repo containing `dir`, and by which rule.
 * `dir` is the plan home; probes are resolved relative to it.
 */
export async function detectPanIgnore(dir: string): Promise<PanIgnoreStatus> {
  const toplevel = await repoToplevel(dir);
  if (!toplevel) return { kind: 'not-a-repo' };

  let stdout = '';
  try {
    // `-z` (NUL-separated, so colons in a source path or pattern cannot
    // mis-parse) requires `--stdin`.
    const pending = execFileAsync(
      'git',
      ['check-ignore', '-v', '-z', '--no-index', '--stdin'],
      { cwd: dir, encoding: 'utf8' },
    );
    // A git that exits before reading stdin (bad config, refused repo) makes
    // this write fail with EPIPE. The exit itself rejects `pending` with git's
    // reason, so the stream error carries nothing more; unhandled, it would
    // crash the process instead.
    pending.child.stdin?.on('error', () => undefined);
    pending.child.stdin?.end(`${PAN_IGNORE_PROBES.join('\0')}\0`);
    ({ stdout } = await pending);
  } catch (error) {
    // Exit 1 is check-ignore's "nothing matched".
    if ((error as ExecFailure).code === 1) return { kind: 'not-ignored', repoRoot: toplevel };
    throw new PlanHomeGitError('check-ignore', dir, firstLine(error));
  }

  // A `!` match re-includes the path; only a plain pattern ignores it.
  const decisive = parseCheckIgnoreRecords(stdout).find((record) => !record.pattern.startsWith('!'));
  if (!decisive) return { kind: 'not-ignored', repoRoot: toplevel };

  // Per-directory and info/exclude sources are relative to the repo root;
  // core.excludesFile is absolute.
  const source = isAbsolute(decisive.source) ? decisive.source : resolve(toplevel, decisive.source);
  const topGitignore = join(toplevel, '.gitignore');
  const legacy = source === topGitignore
    && LEGACY_PAN_IGNORE_PATTERNS.includes(decisive.pattern)
    && (await legacyLineAt(topGitignore, decisive.line)) !== null;
  return {
    kind: legacy ? 'legacy' : 'foreign',
    repoRoot: toplevel,
    source,
    line: decisive.line,
    pattern: decisive.pattern,
  };
}

/** The line's text when line `n` (1-based) of `file` is exactly a legacy pattern, else null. */
async function legacyLineAt(file: string, n: number): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const line = text.split('\n')[n - 1];
  if (line === undefined) return null;
  const bare = line.replace(/\r$/, '').replace(/[ \t]+$/, '');
  return LEGACY_PAN_IGNORE_PATTERNS.includes(bare) ? line : null;
}

/** Remove line `n` (1-based) from `file`, keeping every other byte (EOL style, final newline). */
async function removeLine(file: string, n: number): Promise<void> {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  lines.splice(n - 1, 1);
  await writeFile(file, lines.join('\n'), 'utf8');
}

export interface LegacyPanIgnoreRepair {
  /** Legacy lines removed, in removal order, as numbered at the time of removal. */
  readonly removed: ReadonlyArray<{ readonly line: number; readonly pattern: string }>;
  /** Absolute path of the edited `.gitignore`, when anything was removed. */
  readonly gitignorePath: string | null;
  /** The ignore status after the repair. `foreign` means another rule still ignores `.pan/`. */
  readonly status: PanIgnoreStatus;
}

/**
 * Remove Overdeck's legacy `.pan/` line(s) from the repo's top-level
 * `.gitignore` until `.pan/` is no longer ignored by one. Never touches any
 * other rule and never commits: the caller decides what to commit.
 */
export async function removeLegacyPanIgnore(dir: string): Promise<LegacyPanIgnoreRepair> {
  const removed: Array<{ line: number; pattern: string }> = [];
  let gitignorePath: string | null = null;
  let status = await detectPanIgnore(dir);
  for (let i = 0; i < MAX_LEGACY_REMOVALS && status.kind === 'legacy'; i += 1) {
    await removeLine(status.source, status.line);
    removed.push({ line: status.line, pattern: status.pattern });
    gitignorePath = status.source;
    status = await detectPanIgnore(dir);
  }
  return { removed, gitignorePath, status };
}

/** `path:line (pattern)` for messages. */
export function describePanIgnore(status: PanIgnoreStatus): string {
  if (status.kind !== 'legacy' && status.kind !== 'foreign') return status.kind;
  return `${status.source}:${status.line} (${status.pattern})`;
}

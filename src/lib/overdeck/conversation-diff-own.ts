/**
 * A conversation's own per-file patches for the All turns diff (PAN-5418).
 *
 * PAN-5408 scoped the All turns file list to the conversation's attributed
 * files, but each file's patch still ran from a session-start base commit to
 * the working tree, so every other agent's commit to the same file showed as
 * this conversation's work. This module builds each attributed file's patch
 * from the conversation's attributed commits and its uncommitted edit only:
 *
 * - D1: a file gets one combined `git diff <first>^ [<last>]` when that diff
 *   is provably equal to the conversation's own changes; otherwise it gets one
 *   section per attributed commit plus an uncommitted section.
 * - D2: "provably equal" is a content check (`git diff --quiet a_i a_{i+1}^`),
 *   not a history walk, so it holds for any history shape. Any failure falls
 *   back to sections, which are always exact.
 * - D3: chronological order is the Changes API's newest-first list reversed,
 *   then stably sorted by `authoredAt` ascending.
 * - D4: an attributed sha that no longer resolves contributes no patch.
 * - D5/D6: counts are per-file sums over the attributed entries; `kind` is D
 *   when the file was deleted last, A when it was created first, else the last
 *   entry's status.
 * - D7/D8: sections start with an mbox `From <sha>` / `Subject:` preamble that
 *   `@pierre/diffs`' parsePatchFiles splits on. Callers must put every plain
 *   patch before the first section, or the parser absorbs it into a section.
 * - D9: a renamed file always uses sections, with both paths and `-M`.
 *
 * Every git call is an async execFile with an argument array. This module
 * must not import conversation-diffs.ts or conversation-changes.ts (cycle).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ChangeCommit, ConversationChanges } from '@overdeck/contracts';

import { diffPatchFilesAgainstHead, type TurnDiffFileChange } from '../checkpoint/checkpoint-manager.js';
import { diffOptionArgs, type DiffOptions } from '../diffs/diff-output.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 50 * 1024 * 1024;

/** The uncommitted section's preamble sha (D7). */
export const UNCOMMITTED_SECTION_SHA = '0'.repeat(40);

/** mbox-style section preamble that @pierre/diffs' parsePatchFiles splits on (D7). */
export function sectionPreamble(sha: string, subject: string): string {
  return `From ${sha} Mon Sep 17 00:00:00 2001\nSubject: ${subject.replace(/\r?\n/g, ' ')}\n\n`;
}

/** D3: attributed commits oldest first (input is newest first by authoredAt). */
function chronological(commits: readonly ChangeCommit[]): ChangeCommit[] {
  return [...commits].reverse().sort((a, b) => {
    const delta = Date.parse(a.authoredAt) - Date.parse(b.authoredAt);
    return Number.isFinite(delta) ? delta : 0;
  });
}

/** Per-file sums and kind over attributed commits + uncommitted edits (FR-2, D6). Replaces attributedFiles. */
export function ownFileChanges(changes: ConversationChanges | null): Map<string, TurnDiffFileChange> {
  const entries = new Map<string, Array<{ status: string; additions: number; deletions: number }>>();
  if (!changes) return new Map();
  for (const file of [...chronological(changes.commits).flatMap((commit) => commit.files), ...changes.uncommitted]) {
    const list = entries.get(file.path) ?? [];
    list.push(file);
    entries.set(file.path, list);
  }
  const files = new Map<string, TurnDiffFileChange>();
  for (const [path, list] of entries) {
    const first = list[0].status;
    const last = list[list.length - 1].status;
    files.set(path, {
      path,
      kind: last === 'D' ? 'D' : first === 'A' ? 'A' : last,
      additions: list.reduce((sum, entry) => sum + entry.additions, 0),
      deletions: list.reduce((sum, entry) => sum + entry.deletions, 0),
    });
  }
  return files;
}

/** PAN-5408 FR-5: a new-file patch for an untracked path; `git diff --no-index` exits 1 when the files differ. */
export async function untrackedFilePatch(repoRoot: string, path: string, options: DiffOptions = {}): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      'git',
      ['diff', '--no-index', '--patch', '--minimal', '--no-color', ...diffOptionArgs(options), '--', '/dev/null', path],
      { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    );
    return stdout;
  } catch (error: unknown) {
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === 'string' ? stdout : '';
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
  return stdout;
}

/** True when git exits 0. For `--quiet`/`-e`/`--verify` checks any failure counts as "no", so callers fall back to sections. */
async function gitSucceeds(repoRoot: string, args: string[]): Promise<boolean> {
  try {
    await git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

/** FR-3: true when one combined diff equals the conversation's own changes to `path`. */
async function combinedPatchIsExact(
  repoRoot: string,
  path: string,
  own: readonly ChangeCommit[],
  hasUncommitted: boolean,
  untracked: boolean,
): Promise<boolean> {
  if (own.some((commit) => commit.files.some((file) => file.path === path && file.status === 'R'))) return false;
  if (!(await gitSucceeds(repoRoot, ['rev-parse', '--verify', '--quiet', `${own[0].sha}^`]))) return false;
  for (let i = 0; i + 1 < own.length; i += 1) {
    if (!(await gitSucceeds(repoRoot, ['diff', '--quiet', own[i].sha, `${own[i + 1].sha}^`, '--', path]))) return false;
  }
  if (hasUncommitted) {
    if (untracked) return false;
    if (!(await gitSucceeds(repoRoot, ['diff', '--quiet', own[own.length - 1].sha, 'HEAD', '--', path]))) return false;
  }
  return true;
}

type PathPlan =
  | { kind: 'none' }
  | { kind: 'plain'; patch: string }
  | { kind: 'uncommitted-only' }
  | { kind: 'sections'; own: ChangeCommit[]; uncommitted: 'none' | 'tracked' | 'untracked' };

/** The conversation's own patches for `paths` in `repoRoot` (FR-1, FR-3, FR-4, D8). */
export async function buildOwnPatches(
  repoRoot: string,
  changes: ConversationChanges | null,
  paths: string[],
  options: DiffOptions = {},
): Promise<{ plain: string[]; sections: string[] }> {
  const plain: string[] = [];
  const sections: string[] = [];
  if (paths.length === 0) return { plain, sections };

  // Sequential on purpose: a conversation can attribute hundreds of files, and this
  // runs in the dashboard server, so git processes run one at a time.
  const chrono: ChangeCommit[] = [];
  for (const commit of chronological(changes?.commits ?? [])) {
    if (await gitSucceeds(repoRoot, ['cat-file', '-e', `${commit.sha}^{commit}`])) chrono.push(commit);
  }
  const uncommittedByPath = new Map((changes?.uncommitted ?? []).map((file) => [file.path, file]));

  const planPath = async (path: string): Promise<PathPlan> => {
    const own = chrono.filter((commit) => commit.files.some((file) => file.path === path));
    const unc = uncommittedByPath.get(path);
    const untracked = unc?.status === 'A'
      && (await git(repoRoot, ['ls-files', '--', path]).catch(() => '')).trim() === ''
      && existsSync(join(repoRoot, path));
    if (own.length === 0) {
      if (untracked) return { kind: 'plain', patch: await untrackedFilePatch(repoRoot, path, options) };
      return unc ? { kind: 'uncommitted-only' } : { kind: 'none' };
    }
    if (await combinedPatchIsExact(repoRoot, path, own, unc !== undefined, untracked)) {
      const range = unc ? [`${own[0].sha}^`] : [`${own[0].sha}^`, own[own.length - 1].sha];
      const patch = await git(repoRoot, [
        'diff', '--patch', '--minimal', '--no-color', ...diffOptionArgs(options), ...range, '--', path,
      ]);
      return { kind: 'plain', patch };
    }
    return { kind: 'sections', own, uncommitted: unc ? (untracked ? 'untracked' : 'tracked') : 'none' };
  };
  const plans: PathPlan[] = [];
  for (const path of paths) plans.push(await planPath(path));

  const uncommittedOnly: string[] = [];
  const sectionPaths = new Map<string, Set<string>>();
  const uncommittedSection: string[] = [];
  const uncommittedUntracked: string[] = [];
  paths.forEach((path, index) => {
    const plan = plans[index];
    if (plan.kind === 'plain') {
      if (plan.patch) plain.push(plan.patch);
    } else if (plan.kind === 'uncommitted-only') {
      uncommittedOnly.push(path);
    } else if (plan.kind === 'sections') {
      for (const commit of plan.own) {
        const set = sectionPaths.get(commit.sha) ?? new Set<string>();
        set.add(path);
        for (const file of commit.files) {
          if (file.path === path && file.status === 'R' && file.oldPath) set.add(file.oldPath);
        }
        sectionPaths.set(commit.sha, set);
      }
      if (plan.uncommitted === 'tracked') uncommittedSection.push(path);
      if (plan.uncommitted === 'untracked') uncommittedUntracked.push(path);
    }
  });

  if (uncommittedOnly.length > 0) {
    const patch = await diffPatchFilesAgainstHead(repoRoot, uncommittedOnly, options);
    if (patch) plain.push(patch);
  }

  for (const commit of chrono) {
    const set = sectionPaths.get(commit.sha);
    if (!set) continue;
    const out = await git(repoRoot, [
      'show', '--format=', '--patch', '--minimal', '--no-color', '-M', ...diffOptionArgs(options), commit.sha, '--', ...set,
    ]);
    if (out.trim()) sections.push(sectionPreamble(commit.sha, commit.subject) + out);
  }

  if (uncommittedSection.length > 0 || uncommittedUntracked.length > 0) {
    const parts = [await diffPatchFilesAgainstHead(repoRoot, uncommittedSection, options)];
    for (const path of uncommittedUntracked) parts.push(await untrackedFilePatch(repoRoot, path, options));
    const body = parts.filter(Boolean).join('');
    if (body.trim()) sections.push(sectionPreamble(UNCOMMITTED_SECTION_SHA, 'Uncommitted changes') + body);
  }

  return { plain, sections };
}

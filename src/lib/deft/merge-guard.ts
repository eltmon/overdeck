/**
 * The Deft merge guard (PAN-4820 WI-5): what a Deft issue's PR may not merge.
 *
 * A temporary Directive install is hidden from git, but an agent can still
 * commit parts of it (a `git add -f`, a hook, a copied file). The guard
 * refuses a PR that carries install paths, refuses when Deft-hidden tracked
 * files were edited (those edits are in no commit, H3), and refuses when the
 * Deft state archive at the PR head is stale (AD-13). A native Directive
 * project tracks its own deposit, so it skips every rule (AD-14).
 *
 * `evaluateDeftMergeGuard` is pure apart from the injected head-file reader.
 * `deftMergeGuardForIssue` composes the git reads and fails closed: when the
 * head or the diff cannot be read, or a temporary install's snapshot is
 * missing or unreadable, the PR is not mergeable. Whether the project is a
 * native Directive project is read from its default branch, never from the
 * worktree.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readOpenOperatorDecision, requestOperatorDecision } from '../cloister/operator-decision.js';
import { getPrFacts } from '../cloister/pr-facts.js';
import { getIssueWorkspacePath, resolveProjectForIssue } from '../overdeck/issue-projects.js';
import { defaultBranchForRepo } from '../project-repos.js';
import { isDeftArchiveCurrent, isNativeDirectiveProject } from './archive.js';
import { type DeftInstallSnapshot, readDeftSnapshot } from './install-snapshot.js';

const execFileAsync = promisify(execFile);
const DIFF_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface DeftGuardInput {
  /** Repo-relative, from the PR diff. */
  changedPaths: string[];
  /** File content at the PR head; null when absent. */
  headFile: (path: string) => Promise<string | null>;
  snapshot: DeftInstallSnapshot | null;
  directiveProject: boolean;
  drifted: string[];
  archiveCurrent: boolean;
}

export type DeftGuardVerdict = { ok: true } | { ok: false; reason: string; paths: string[] };

const DEPOSIT_PREFIXES = ['.deft/', '.deft-scratch/', '.deft-cache/', 'xbrief/', '.githooks/'];
const DEPOSIT_PATTERNS = [
  /^\.(agents|claude|cursor|codex|github)\/skills\/deft(-directive-[^/]+)?\//,
  /^\.(claude|cursor|grok)\/commands\/deft-/,
  /^\.codex\/prompts\/deft-/,
  /^\.(claude|codex)\/deft-hook-[^/]+\.mjs$/,
  /^\.(cursor|grok)\/hooks\/deft/,
];
/** Tracked files that are a deposit only when their head content carries Directive's marker. */
const CONTENT_MARKERS: Record<string, string> = {
  'AGENTS.md': '<!-- deft:managed-section',
  'package.json': '"@deftai/directive',
  'Taskfile.yml': '@deftai/directive-runtime',
  '.gitignore': '.deft/directive/wiring-ready',
};

function underSnapshotPath(path: string, snapshot: DeftInstallSnapshot | null): boolean {
  if (!snapshot) return false;
  const hidden = [...snapshot.createdPaths, ...snapshot.modifiedTracked.map(entry => entry.path)];
  return hidden.some(entry => {
    const dir = entry.endsWith('/') ? entry : `${entry}/`;
    return path === entry.replace(/\/$/, '') || path.startsWith(dir);
  });
}

async function isDepositPath(path: string, input: DeftGuardInput): Promise<boolean> {
  if (underSnapshotPath(path, input.snapshot)) return true;
  if (DEPOSIT_PREFIXES.some(prefix => path.startsWith(prefix))) return true;
  if (DEPOSIT_PATTERNS.some(pattern => pattern.test(path))) return true;
  const marker = CONTENT_MARKERS[path];
  if (marker === undefined) return false;
  return (await input.headFile(path))?.includes(marker) ?? false;
}

export async function evaluateDeftMergeGuard(input: DeftGuardInput): Promise<DeftGuardVerdict> {
  if (input.directiveProject) return { ok: true };
  if (input.drifted.length > 0) {
    return {
      ok: false,
      reason: `Deft-hidden files were edited and are in no commit: ${input.drifted.join(', ')}. Switch back to Overdeck or ask the operator.`,
      paths: input.drifted,
    };
  }
  const deposit: string[] = [];
  for (const path of input.changedPaths) {
    if (await isDepositPath(path, input)) deposit.push(path);
  }
  if (deposit.length > 0) return { ok: false, reason: `PR contains Deft install paths: ${deposit.join(', ')}`, paths: deposit };
  if (!input.archiveCurrent) {
    return { ok: false, reason: 'Deft state is not saved at the PR head; run pan skills deft save <ISSUE>', paths: [] };
  }
  return { ok: true };
}

// ── reads ────────────────────────────────────────────────────────────────

/** `git diff --name-only -z <baseRef>...<headSha>`. Throws on failure. */
export async function readPrChangedPaths(worktree: string, baseRef: string, headSha: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '-z', `${baseRef}...${headSha}`], {
    cwd: worktree,
    timeout: DIFF_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.split('\0').filter(Boolean);
}

/** `git show <headSha>:<path>`, or null on any error. */
export async function readHeadFile(worktree: string, headSha: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${headSha}:${path}`], { cwd: worktree, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch {
    return null;
  }
}

/** Hidden tracked files whose worktree content no longer matches what the install left. */
export async function detectDrift(worktree: string, snapshot: DeftInstallSnapshot | null): Promise<string[]> {
  if (!snapshot) return [];
  const drifted: string[] = [];
  for (const entry of snapshot.modifiedTracked) {
    let sha = '';
    try {
      sha = createHash('sha256').update(await readFile(join(worktree, entry.path))).digest('hex');
    } catch {
      // A deleted hidden file has drifted too.
    }
    if (sha !== entry.postInstallSha256) drifted.push(entry.path);
  }
  return drifted;
}

export function deftDriftQuestion(issueId: string, paths: string[]): string {
  return `Deft-hidden files changed in ${issueId.toUpperCase()}: ${paths.join(', ')}. Keep Deft's version or switch back to Overdeck?`;
}

/**
 * Raise one operator decision per drift set (AD-18). The same question is not
 * raised again while it is open.
 */
export function raiseDeftDriftDecision(workspacePath: string, issueId: string, paths: string[]): void {
  const question = deftDriftQuestion(issueId, paths);
  if (readOpenOperatorDecision(workspacePath)?.question === question) return;
  requestOperatorDecision(workspacePath, {
    issueId: issueId.toUpperCase(),
    agentId: `agent-${issueId.toLowerCase()}`,
    question,
    options: ['Switch back to Overdeck', 'Discard the edits'],
  });
}

const couldNotRead = (message: string): DeftGuardVerdict & { drifted: string[] } => ({
  ok: false,
  reason: `merge guard could not read the PR's changed files: ${message}`,
  paths: [],
  drifted: [],
});

/**
 * The guard for one issue's PR. A null `headSha` is resolved from the PR
 * facts. Any failure to read the head or the diff refuses.
 */
export async function deftMergeGuardForIssue(
  issueId: string,
  headSha: string | null,
): Promise<DeftGuardVerdict & { drifted: string[] }> {
  const worktree = getIssueWorkspacePath(issueId);
  if (!worktree) return couldNotRead(`no workspace for ${issueId.toUpperCase()}`);

  let head = headSha;
  if (!head) {
    try {
      head = (await getPrFacts(issueId)).headSha;
    } catch (error) {
      return couldNotRead(error instanceof Error ? error.message : String(error));
    }
    if (!head) return couldNotRead('no PR head');
  }

  const baseRef = `origin/${defaultBranchForRepo(resolveProjectForIssue(issueId), worktree)}`;
  let changedPaths: string[];
  try {
    changedPaths = await readPrChangedPaths(worktree, baseRef, head);
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return couldNotRead((e.stderr || e.message || String(error)).trim());
  }

  const snapshot = await readDeftSnapshot(worktree);
  const directiveProject = await isNativeDirectiveProject(worktree);
  // A temporary install is only verifiable through its snapshot. Missing or
  // unreadable (deleted, cleaned, corrupt), the guard cannot vouch for the PR.
  if (!directiveProject && !snapshot) {
    return {
      ok: false,
      reason: `the Deft install snapshot for ${issueId.toUpperCase()} (.overdeck/deft-install.json) is missing or unreadable, so the merge guard cannot vouch for this PR; run pan skills deft show ${issueId.toUpperCase()}, then switch back to Overdeck or ask the operator`,
      paths: [],
      drifted: [],
    };
  }
  const [drifted, archiveCurrent] = await Promise.all([
    detectDrift(worktree, snapshot),
    isDeftArchiveCurrent(worktree, issueId, head),
  ]);
  const resolvedHead = head;
  const verdict = await evaluateDeftMergeGuard({
    changedPaths,
    headFile: path => readHeadFile(worktree, resolvedHead, path),
    snapshot,
    directiveProject,
    drifted,
    archiveCurrent,
  });
  return {
    ...verdict,
    ...(verdict.ok ? {} : { reason: verdict.reason.replace('<ISSUE>', issueId.toUpperCase()) }),
    drifted,
  };
}

/**
 * Assembly-agent conflict resolution (PAN-1737: UAT batch trains).
 *
 * Implements the engine's `resolveConflict` hook: when merging a feature onto
 * a UAT generation branch conflicts, a TIMEBOXED headless agent run is given
 * the mid-conflict worktree with one mission — resolve THIS merge's conflict
 * markers, changing nothing beyond the resolution.
 *
 * Division of labor, deliberately strict:
 *   - The agent only EDITS FILES (headless `claude -p` with acceptEdits; no
 *     shell access). It cannot stage, commit, push, or wander.
 *   - This module verifies the result in code (no leftover conflict markers,
 *     no unmerged index entries), stages, and concludes the merge commit.
 *   - Any failure — agent missing, timeout, markers left, commit rejected —
 *     returns null; the engine then aborts the merge and holds the feature
 *     out. The assembly NEVER wedges on a conflict.
 *
 * The merge commit subject keeps git's standard `Merge branch ...` form (it
 * survives commitlint's default-ignores when this history is later promoted
 * to main); the auditable `uat-assembly:` marker lives in the body.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ConflictContext, ConflictResolutionResult } from './uat-generation-engine.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_CONFLICT_TIMEOUT_MS = 5 * 60 * 1000;

/** Injectable I/O so the hook's decision logic is unit-testable. */
export interface ConflictAgentDeps {
  /** Paths with unmerged index entries (`git diff --name-only --diff-filter=U`). */
  listConflictedFiles(cwd: string): Promise<string[]>;
  /** Run the headless resolution agent; throws on spawn failure or timeout. */
  runAgent(args: { prompt: string; cwd: string; timeoutMs: number }): Promise<void>;
  /** Subset of `files` still containing conflict markers after the agent ran. */
  filesWithConflictMarkers(cwd: string, files: readonly string[]): Promise<string[]>;
  /** `git add -A`. */
  stageAll(cwd: string): Promise<void>;
  /** True if unmerged index entries remain after staging. */
  hasUnmergedEntries(cwd: string): Promise<boolean>;
  /** Conclude the in-progress merge with the given message. */
  commitMerge(cwd: string, message: string): Promise<void>;
  headSha(cwd: string): Promise<string>;
  log?: (msg: string) => void;
}

export interface ConflictAgentOptions {
  timeoutMs?: number;
  deps?: Partial<ConflictAgentDeps>;
}

export function buildConflictResolutionPrompt(ctx: ConflictContext, conflictedFiles: readonly string[]): string {
  const counterparts = ctx.conflictingIssueIds.length > 0
    ? ctx.conflictingIssueIds.join(', ')
    : 'an earlier batch member';
  return [
    `You are resolving a git merge conflict inside a UAT batch assembly worktree.`,
    ``,
    `The branch ${ctx.branchName} bundles already-reviewed features for human testing.`,
    `Merging ${ctx.feature.branch} (${ctx.feature.issueId}: ${ctx.feature.title}) conflicted with ${counterparts}.`,
    ``,
    `Conflicted files:`,
    ...conflictedFiles.map((f) => `  - ${f}`),
    ``,
    `Your ONLY job: edit these files to resolve every conflict marker (<<<<<<<, =======, >>>>>>>)`,
    `so that BOTH features' intended behavior is preserved. Both sides passed review —`,
    `combine them; do not pick one side wholesale unless the changes are genuinely identical in intent.`,
    ``,
    `Rules:`,
    `- Change NOTHING beyond what resolving the conflict requires.`,
    `- Do not refactor, reformat, or "improve" surrounding code.`,
    `- Do not run git commands; the caller stages and commits.`,
    `- If the conflict cannot be safely resolved, leave the markers in place and say so.`,
  ].join('\n');
}

function buildMergeCommitMessage(ctx: ConflictContext, files: readonly string[]): string {
  const pair = [ctx.feature.issueId, ...ctx.conflictingIssueIds].join(' <-> ');
  return [
    `Merge branch '${ctx.feature.branch}' into ${ctx.branchName}`,
    ``,
    `uat-assembly: resolve ${pair}`,
    `files: ${files.join(', ')}`,
  ].join('\n');
}

function defaultDeps(): ConflictAgentDeps {
  const run = (cmd: string, args: string[], cwd: string, timeoutMs?: number) =>
    execFileAsync(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024, ...(timeoutMs ? { timeout: timeoutMs } : {}) });

  return {
    listConflictedFiles: async (cwd) => {
      const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=U'], cwd);
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
    runAgent: async ({ prompt, cwd, timeoutMs }) => {
      await run('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], cwd, timeoutMs);
    },
    filesWithConflictMarkers: async (cwd, files) => {
      if (files.length === 0) return [];
      // -l: names only; -E for the alternation. grep exits 1 on no matches.
      const { stdout } = await execFileAsync(
        'grep', ['-lE', '^(<<<<<<<|=======$|>>>>>>>)', '--', ...files],
        { cwd, maxBuffer: 16 * 1024 * 1024 },
      ).catch((err: { code?: number; stdout?: string }) => {
        if (err && err.code === 1) return { stdout: '' };
        throw err;
      });
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
    stageAll: async (cwd) => { await run('git', ['add', '-A'], cwd); },
    hasUnmergedEntries: async (cwd) => {
      const { stdout } = await run('git', ['ls-files', '-u'], cwd);
      return stdout.trim().length > 0;
    },
    commitMerge: async (cwd, message) => {
      await run('git', ['commit', '-m', message], cwd);
    },
    headSha: async (cwd) => (await run('git', ['rev-parse', 'HEAD'], cwd)).stdout.trim(),
  };
}

/**
 * Build the engine's `resolveConflict` hook. Returns the resolution on
 * success; null on ANY failure (the engine aborts the merge and holds the
 * feature out — never throws into the assembly loop).
 */
export function buildConflictAgentHook(
  options: ConflictAgentOptions = {},
): (ctx: ConflictContext) => Promise<ConflictResolutionResult | null> {
  const deps: ConflictAgentDeps = { ...defaultDeps(), ...(options.deps ?? {}) };
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFLICT_TIMEOUT_MS;
  const log = deps.log ?? (() => {});

  return async (ctx) => {
    const tag = `[uat-conflict-agent] ${ctx.branchName} ${ctx.feature.issueId}`;
    let files: string[];
    try {
      files = await deps.listConflictedFiles(ctx.worktreePath);
    } catch (err) {
      log(`${tag}: could not list conflicted files: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (files.length === 0) {
      log(`${tag}: merge failed without unmerged paths — not a content conflict, giving up`);
      return null;
    }

    try {
      await deps.runAgent({
        prompt: buildConflictResolutionPrompt(ctx, files),
        cwd: ctx.worktreePath,
        timeoutMs,
      });
    } catch (err) {
      log(`${tag}: agent run failed (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`);
      return null;
    }

    try {
      const unresolved = await deps.filesWithConflictMarkers(ctx.worktreePath, files);
      if (unresolved.length > 0) {
        log(`${tag}: conflict markers remain in ${unresolved.join(', ')}`);
        return null;
      }
      await deps.stageAll(ctx.worktreePath);
      if (await deps.hasUnmergedEntries(ctx.worktreePath)) {
        log(`${tag}: unmerged index entries remain after staging`);
        return null;
      }
      await deps.commitMerge(ctx.worktreePath, buildMergeCommitMessage(ctx, files));
      const commitSha = await deps.headSha(ctx.worktreePath);
      log(`${tag}: resolved ${files.length} file(s) at ${commitSha.slice(0, 9)}`);
      return { files, commitSha };
    } catch (err) {
      log(`${tag}: verification/commit failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      return null;
    }
  };
}

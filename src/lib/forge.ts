import { exec } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unlink, writeFile } from 'node:fs/promises';
import { Effect, Data } from 'effect';
import {
  getPullRequestState,
  isGitHubAppConfigured,
  mergePullRequestWithApp,
  parsePullRequestRef,
} from './github-app.js';

/** A forge (GitHub or GitLab) review-artifact operation failed. */
export class ForgeError extends Data.TaggedError('ForgeError')<{
  readonly forge: 'github' | 'gitlab';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const execAsync = promisify(exec);
const GITHUB_MERGE_POLL_INTERVAL_MS = 5000;
export const GITHUB_MERGE_TIMEOUT_MS = 15 * 60 * 1000;

export type ForgeType = 'github' | 'gitlab';

export interface ReviewArtifactRef {
  forge: ForgeType;
  url?: string;
  id?: string;
}

export interface CreateReviewArtifactInput {
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
  cwd?: string;
  repository?: string;
}

export interface CreateReviewArtifactResult extends ReviewArtifactRef {
  created: boolean;
}

export interface MergeReviewArtifactInput extends ReviewArtifactRef {
  method?: 'merge' | 'squash' | 'rebase';
  cwd?: string;
  repository?: string;
}

export interface CommentOnArtifactInput extends ReviewArtifactRef {
  body: string;
  cwd?: string;
  repository?: string;
}

export interface ApproveReviewArtifactInput extends ReviewArtifactRef {
  cwd?: string;
  repository?: string;
}

export interface DiscoverArtifactInput {
  sourceBranch: string;
  cwd?: string;
  repository?: string;
}

export interface ForgeAdapter {
  readonly forge: ForgeType;
  createReviewArtifact(input: CreateReviewArtifactInput): Promise<CreateReviewArtifactResult>;
  mergeReviewArtifact(input: MergeReviewArtifactInput): Promise<void>;
  commentOnArtifact(input: CommentOnArtifactInput): Promise<void>;
  approveReviewArtifact(input: ApproveReviewArtifactInput): Promise<void>;
  discoverArtifact(input: DiscoverArtifactInput): Promise<CreateReviewArtifactResult | null>;
}

async function withBodyFile<T>(body: string | undefined, prefix: string, fn: (bodyFile?: string) => Promise<T>): Promise<T> {
  if (!body) return fn(undefined);

  const bodyFile = join(tmpdir(), `${prefix}-${Date.now()}.md`);
  await writeFile(bodyFile, body, 'utf-8');
  try {
    return await fn(bodyFile);
  } finally {
    await unlink(bodyFile).catch(() => {});
  }
}

function buildRepositoryFlag(repository?: string): string {
  return repository ? ` --repo ${repository}` : '';
}

function buildGitHubReviewTarget(input: Pick<MergeReviewArtifactInput | CommentOnArtifactInput, 'url' | 'id'>): string {
  return input.url || input.id || '';
}

function buildGitLabReviewTarget(input: Pick<MergeReviewArtifactInput | CommentOnArtifactInput, 'url' | 'id'>): string {
  return input.id || input.url || '';
}

async function getExistingGitHubArtifact(
  branchName: string,
  cwd?: string,
  repository?: string
): Promise<CreateReviewArtifactResult | null> {
  const { stdout } = await execAsync(
    `gh pr view ${branchName}${buildRepositoryFlag(repository)} --json url,number 2>/dev/null || true`,
    { cwd, encoding: 'utf-8' }
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as { url?: string; number?: number };
  return {
    forge: 'github',
    created: false,
    url: parsed.url,
    id: parsed.number ? String(parsed.number) : undefined,
  };
}

async function getExistingGitLabArtifact(
  branchName: string,
  cwd?: string,
  repository?: string
): Promise<CreateReviewArtifactResult | null> {
  const { stdout } = await execAsync(
    `glab mr list --source-branch ${branchName}${buildRepositoryFlag(repository)} --state opened --json iid,web_url 2>/dev/null || true`,
    { cwd, encoding: 'utf-8' }
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as Array<{ iid?: number; web_url?: string }>;
  const existing = parsed[0];
  if (!existing) return null;
  return {
    forge: 'gitlab',
    created: false,
    url: existing.web_url,
    id: existing.iid ? String(existing.iid) : undefined,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGitHubMergeState(state: Awaited<ReturnType<typeof getPullRequestState>>): boolean {
  if (state.merged) return false;
  if (state.draft) return false;
  if (state.checksFailed) return false;
  if (state.checksPending) return true;
  if (state.mergeable === null) return true;
  return ['unknown', 'blocked', 'behind', 'unstable', 'has_hooks'].includes(state.mergeableState || '');
}

const githubForgeAdapter: ForgeAdapter = {
  forge: 'github',

  async createReviewArtifact(input) {
    const existing = await getExistingGitHubArtifact(input.sourceBranch, input.cwd, input.repository);
    if (existing) return existing;

    return withBodyFile(input.body, 'pan-gh-pr-body', async (bodyFile) => {
      const bodyFlag = bodyFile ? ` --body-file "${bodyFile}"` : '';
      const { stdout } = await execAsync(
        `gh pr create --head ${input.sourceBranch} --base ${input.targetBranch} --title "${input.title}"${bodyFlag}${buildRepositoryFlag(input.repository)}`,
        { cwd: input.cwd, encoding: 'utf-8' }
      );
      const url = stdout.trim().split('\n').pop()?.trim() || stdout.trim();
      const created = await getExistingGitHubArtifact(input.sourceBranch, input.cwd, input.repository);
      return {
        forge: 'github',
        created: true,
        url,
        id: created?.id,
      };
    });
  },

  async mergeReviewArtifact(input) {
    const target = buildGitHubReviewTarget(input);
    const method = input.method || 'squash';
    console.log(`[forge] mergeReviewArtifact: ${input.forge} ${target} method=${method} repo=${input.repository ?? 'default'}`);
    if (!isGitHubAppConfigured()) {
      try {
        console.log(`[forge] gh pr merge: executing ${method} merge for ${target}`);
        await execAsync(
          `gh pr merge ${target}${buildRepositoryFlag(input.repository)} --${method}`,
          { cwd: input.cwd, encoding: 'utf-8' }
        );
        console.log(`[forge] gh pr merge: completed successfully for ${target}`);
        return;
      } catch (err: any) {
        console.error(`[forge] gh pr merge: failed for ${target}: exitCode=${err.code} message=${err.message}`);
        throw err;
      }
    }

    const ref = parsePullRequestRef(input);
    const deadline = Date.now() + GITHUB_MERGE_TIMEOUT_MS;
    console.log(`[forge] mergeReviewArtifact: GitHub App path for ${ref.owner}/${ref.repo}#${ref.number}, timeout=${GITHUB_MERGE_TIMEOUT_MS}ms`);

    while (Date.now() < deadline) {
      const state = await getPullRequestState(ref.owner, ref.repo, ref.number);
      console.log(`[forge] mergeReviewArtifact: PR #${ref.number} state=${state.state} merged=${state.merged} draft=${state.draft} checksFailed=${state.checksFailed}`);

      if (state.merged) return;
      if (state.state !== 'OPEN') {
        throw new Error(`GitHub PR #${ref.number} is closed but not merged`);
      }
      if (state.draft) {
        throw new Error(`GitHub PR #${ref.number} is still marked as draft`);
      }
      if (state.checksFailed) {
        throw new Error(`GitHub PR #${ref.number} has failing required checks`);
      }

      if (isTransientGitHubMergeState(state)) {
        await delay(GITHUB_MERGE_POLL_INTERVAL_MS);
        continue;
      }

      try {
        const mergeResult = await mergePullRequestWithApp(
          ref.owner,
          ref.repo,
          ref.number,
          method,
          state.headSha || undefined,
        );
        console.log(`[forge] mergePullRequestWithApp: result merged=${mergeResult.merged} for ${ref.owner}/${ref.repo}#${ref.number}`);
        if (mergeResult.merged) return;
      } catch (err: any) {
        const message = String(err?.message || err);
        console.error(`[forge] mergePullRequestWithApp: threw for ${ref.number}: ${message}`);
        if (
          message.includes('405') ||
          message.includes('409') ||
          message.includes('422') ||
          message.includes('not mergeable') ||
          message.includes('Base branch was modified') ||
          message.includes('required status check') ||
          message.includes('Head branch was modified')
        ) {
          await delay(GITHUB_MERGE_POLL_INTERVAL_MS);
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Timed out waiting for GitHub PR #${ref.number} to become mergeable`);
  },

  async commentOnArtifact(input) {
    const target = buildGitHubReviewTarget(input);
    await withBodyFile(input.body, 'pan-gh-pr-comment', async (bodyFile) => {
      const bodyFlag = bodyFile ? ` --body-file "${bodyFile}"` : ` --body "${input.body.replace(/"/g, '\\"')}"`;
      await execAsync(
        `gh pr comment ${target}${buildRepositoryFlag(input.repository)}${bodyFlag}`,
        { cwd: input.cwd, encoding: 'utf-8' }
      );
    });
  },

  async approveReviewArtifact(input) {
    const target = buildGitHubReviewTarget(input);
    await execAsync(
      `gh pr review ${target} --approve${buildRepositoryFlag(input.repository)}`,
      { cwd: input.cwd, encoding: 'utf-8' }
    );
  },

  async discoverArtifact(input) {
    return getExistingGitHubArtifact(input.sourceBranch, input.cwd, input.repository);
  },
};

const gitlabForgeAdapter: ForgeAdapter = {
  forge: 'gitlab',

  async createReviewArtifact(input) {
    const existing = await getExistingGitLabArtifact(input.sourceBranch, input.cwd, input.repository);
    if (existing) return existing;

    const bodyEnv = input.body ? { PAN_MR_BODY: input.body } : {};
    const bodyFlag = input.body ? ' --description "$PAN_MR_BODY"' : '';
    const { stdout } = await execAsync(
      `glab mr create --source-branch ${input.sourceBranch} --target-branch ${input.targetBranch} --title "${input.title}"${bodyFlag}${buildRepositoryFlag(input.repository)}`,
      { cwd: input.cwd, encoding: 'utf-8', env: { ...process.env, ...bodyEnv }, shell: '/bin/bash' }
    );
    const url = stdout.trim().split('\n').pop()?.trim() || stdout.trim();
    const created = await getExistingGitLabArtifact(input.sourceBranch, input.cwd, input.repository);
    return {
      forge: 'gitlab',
      created: true,
      url,
      id: created?.id,
    };
  },

  async mergeReviewArtifact(input) {
    const target = buildGitLabReviewTarget(input);
    const squashFlag = input.method === 'squash' || !input.method ? ' --squash' : '';
    await execAsync(
      `glab mr merge ${target}${buildRepositoryFlag(input.repository)}${squashFlag}`,
      { cwd: input.cwd, encoding: 'utf-8' }
    );
  },

  async commentOnArtifact(input) {
    const target = buildGitLabReviewTarget(input);
    await withBodyFile(input.body, 'pan-gl-mr-comment', async (bodyFile) => {
      const bodyFlag = bodyFile ? ` --message-file "${bodyFile}"` : ` --message "${input.body.replace(/"/g, '\\"')}"`;
      await execAsync(
        `glab mr note ${target}${buildRepositoryFlag(input.repository)}${bodyFlag}`,
        { cwd: input.cwd, encoding: 'utf-8' }
      );
    });
  },

  async approveReviewArtifact(input) {
    const target = buildGitLabReviewTarget(input);
    await execAsync(
      `glab mr approve ${target}${buildRepositoryFlag(input.repository)}`,
      { cwd: input.cwd, encoding: 'utf-8' }
    );
  },

  async discoverArtifact(input) {
    return getExistingGitLabArtifact(input.sourceBranch, input.cwd, input.repository);
  },
};

export function getForgeAdapter(forge: ForgeType): ForgeAdapter {
  return forge === 'gitlab' ? gitlabForgeAdapter : githubForgeAdapter;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const wrapForgeOp = <T>(
  forge: ForgeType,
  operation: string,
  thunk: () => Promise<T>,
): Effect.Effect<T, ForgeError> =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) =>
      new ForgeError({
        forge,
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect-native createReviewArtifact bound to the adapter for {@link forge}. */
export const createReviewArtifactEffect = (
  forge: ForgeType,
  input: CreateReviewArtifactInput,
): Effect.Effect<CreateReviewArtifactResult, ForgeError> =>
  wrapForgeOp(forge, 'createReviewArtifact', () =>
    getForgeAdapter(forge).createReviewArtifact(input),
  );

/** Effect-native mergeReviewArtifact bound to the adapter for {@link forge}. */
export const mergeReviewArtifactEffect = (
  forge: ForgeType,
  input: MergeReviewArtifactInput,
): Effect.Effect<void, ForgeError> =>
  wrapForgeOp(forge, 'mergeReviewArtifact', () =>
    getForgeAdapter(forge).mergeReviewArtifact(input),
  );

/** Effect-native commentOnArtifact bound to the adapter for {@link forge}. */
export const commentOnArtifactEffect = (
  forge: ForgeType,
  input: CommentOnArtifactInput,
): Effect.Effect<void, ForgeError> =>
  wrapForgeOp(forge, 'commentOnArtifact', () =>
    getForgeAdapter(forge).commentOnArtifact(input),
  );

/** Effect-native approveReviewArtifact bound to the adapter for {@link forge}. */
export const approveReviewArtifactEffect = (
  forge: ForgeType,
  input: ApproveReviewArtifactInput,
): Effect.Effect<void, ForgeError> =>
  wrapForgeOp(forge, 'approveReviewArtifact', () =>
    getForgeAdapter(forge).approveReviewArtifact(input),
  );

/** Effect-native discoverArtifact bound to the adapter for {@link forge}. */
export const discoverArtifactEffect = (
  forge: ForgeType,
  input: DiscoverArtifactInput,
): Effect.Effect<CreateReviewArtifactResult | null, ForgeError> =>
  wrapForgeOp(forge, 'discoverArtifact', () =>
    getForgeAdapter(forge).discoverArtifact(input),
  );

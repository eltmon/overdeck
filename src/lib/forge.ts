import { exec } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unlink, writeFile } from 'node:fs/promises';

const execAsync = promisify(exec);

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

export interface ForgeAdapter {
  readonly forge: ForgeType;
  createReviewArtifact(input: CreateReviewArtifactInput): Promise<CreateReviewArtifactResult>;
  mergeReviewArtifact(input: MergeReviewArtifactInput): Promise<void>;
  commentOnArtifact(input: CommentOnArtifactInput): Promise<void>;
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
    await execAsync(
      `gh pr merge ${target}${buildRepositoryFlag(input.repository)} --${method}`,
      { cwd: input.cwd, encoding: 'utf-8' }
    );
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
};

const gitlabForgeAdapter: ForgeAdapter = {
  forge: 'gitlab',

  async createReviewArtifact(input) {
    const existing = await getExistingGitLabArtifact(input.sourceBranch, input.cwd, input.repository);
    if (existing) return existing;

    return withBodyFile(input.body, 'pan-gl-mr-body', async (bodyFile) => {
      const bodyFlag = bodyFile ? ` --description-file "${bodyFile}"` : '';
      const { stdout } = await execAsync(
        `glab mr create --source-branch ${input.sourceBranch} --target-branch ${input.targetBranch} --title "${input.title}"${bodyFlag}${buildRepositoryFlag(input.repository)}`,
        { cwd: input.cwd, encoding: 'utf-8' }
      );
      const url = stdout.trim().split('\n').pop()?.trim() || stdout.trim();
      const created = await getExistingGitLabArtifact(input.sourceBranch, input.cwd, input.repository);
      return {
        forge: 'gitlab',
        created: true,
        url,
        id: created?.id,
      };
    });
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
};

export function getForgeAdapter(forge: ForgeType): ForgeAdapter {
  return forge === 'gitlab' ? gitlabForgeAdapter : githubForgeAdapter;
}

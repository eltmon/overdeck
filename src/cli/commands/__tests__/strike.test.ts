import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const agentMocks = vi.hoisted(() => ({
  getAgentRuntimeState: vi.fn(),
  spawnAgent: vi.fn(),
  stopAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExists: vi.fn(),
  isHarnessProcessAlive: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  getAgentRuntimeState: agentMocks.getAgentRuntimeState,
  spawnAgent: agentMocks.spawnAgent,
  stopAgent: agentMocks.stopAgent,
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExists: tmuxMocks.sessionExists,
  isHarnessProcessAlive: tmuxMocks.isHarnessProcessAlive,
}));

import { strikeCommand, __testInternals } from '../strike.js';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

describe('strikeCommand', () => {
  beforeEach(() => {
    agentMocks.getAgentRuntimeState.mockReset();
    agentMocks.spawnAgent.mockReset();
    agentMocks.stopAgent.mockReset();
    tmuxMocks.sessionExists.mockReset();
    tmuxMocks.isHarnessProcessAlive.mockReset();
    tmuxMocks.isHarnessProcessAlive.mockResolvedValue(true);
  });

  it('exports a function', () => {
    expect(typeof strikeCommand).toBe('function');
  });

  it('parses multiple positional issue IDs through commander', () => {
    const program = new Command();
    let capturedIds: string[] = [];
    let capturedOptions: Record<string, unknown> = {};

    program
      .command('strike <ids...>')
      .option('--model <model>', 'Model override')
      .option('--harness <harness>', 'Harness')
      .option('--effort <level>', 'Effort')
      .option('--dry-run', 'Dry run')
      .action((ids: string[], options: Record<string, unknown>) => {
        capturedIds = ids;
        capturedOptions = options;
      });

    // Mimic `pan strike PAN-1052 PAN-1141 --model claude-sonnet-4-6 --dry-run`
    program.parse(['strike', 'PAN-1052', 'PAN-1141', '--model', 'claude-sonnet-4-6', '--dry-run'], { from: 'user' });

    expect(capturedIds).toEqual(['PAN-1052', 'PAN-1141']);
    expect(capturedOptions.model).toBe('claude-sonnet-4-6');
    expect(capturedOptions.dryRun).toBe(true);
  });

  const basePlan = {
    issueId: 'PAN-1234',
    workspace: '/tmp/feature-pan-1234-strike',
    branch: 'strike/pan-1234',
    sessionName: 'strike-pan-1234',
    projectRoot: '/tmp/project',
    forge: 'github' as const,
    baseBranch: 'main',
  };

  it('buildStrikePrompt includes the issue id, branch, and workspace', () => {
    const prompt = __testInternals.buildStrikePrompt(basePlan);
    expect(prompt).toContain('PAN-1234');
    expect(prompt).toContain('strike/pan-1234');
    expect(prompt).toContain('/tmp/feature-pan-1234-strike');
    expect(prompt).not.toMatch(/merge fast-forward/);
    expect(prompt).not.toMatch(/push\s+origin\s+main/);
    expect(prompt).not.toContain('git rebase origin/main');
    expect(prompt).toContain('pan sync-main PAN-1234');
    expect(prompt).toContain('git push origin strike/pan-1234');
    expect(prompt).not.toContain('pan tell flywheel-orchestrator');
    // Strike must explicitly not call the normal review-pipeline form.
    expect(prompt).toContain('Do NOT call `pan done`');
  });

  // PAN-3973: nothing lands a pushed strike branch after the PAN-3917 cut, so
  // the strike agent opens the PR itself and the operator merges it.
  it('buildStrikePrompt tells the agent to open a PR that closes the GitHub issue', () => {
    const prompt = __testInternals.buildStrikePrompt({
      ...basePlan,
      forgeRepo: 'eltmon/overdeck',
      closesGithubIssue: 1234,
    });
    expect(prompt).toContain('gh pr create --base main --head strike/pan-1234 --repo eltmon/overdeck');
    expect(prompt).toContain('Closes #1234');
    expect(prompt).not.toContain('glab');
    expect(prompt).toMatch(/Print the pull request URL as your final message/);
    expect(prompt).not.toMatch(/Deacon/);
    expect(prompt).not.toContain('strike-ready');
    expect(prompt).not.toMatch(/merge door/);
    expect(prompt).toContain('Do NOT call `pan done`');
  });

  it('buildStrikePrompt references a GitHub-hosted, non-GitHub-tracked issue without a closing keyword', () => {
    const prompt = __testInternals.buildStrikePrompt({
      ...basePlan,
      issueId: 'LEX-12',
      branch: 'strike/lex-12',
      forgeRepo: 'eltmon/lexerra',
    });
    expect(prompt).toContain('gh pr create --base main --head strike/lex-12 --repo eltmon/lexerra');
    expect(prompt).not.toContain('Closes #');
    expect(prompt).toContain('Issue: LEX-12');
  });

  // Review of #3987: a GitLab project gets `glab mr create` as THE command,
  // not a GitHub command with a glab afterthought.
  it('buildStrikePrompt opens a GitLab merge request against the base branch for a GitLab project', () => {
    const prompt = __testInternals.buildStrikePrompt({
      ...basePlan,
      issueId: 'MIN-42',
      branch: 'strike/min-42',
      forge: 'gitlab',
      baseBranch: 'develop',
      forgeRepo: 'mind-your-now/api',
    });
    expect(prompt).toContain('glab mr create --target-branch develop --source-branch strike/min-42 --repo mind-your-now/api');
    expect(prompt).not.toContain('gh pr create');
    expect(prompt).not.toContain('Closes #');
    expect(prompt).toContain('Issue: MIN-42');
    expect(prompt).toMatch(/Print the merge request URL as your final message/);
    expect(prompt).toContain('Do NOT push `origin develop`');
    expect(prompt.replace(/sync-main/g, '')).not.toMatch(/\bmain\b/);
  });

  it('buildStrikePrompt targets a non-main default branch', () => {
    const prompt = __testInternals.buildStrikePrompt({ ...basePlan, baseBranch: 'trunk' });
    expect(prompt).toContain('gh pr create --base trunk --head strike/pan-1234');
    expect(prompt).toContain('Do NOT push `origin trunk`');
    expect(prompt).not.toContain('--base main');
  });

  describe('planStrike (review of #3987: Closes only for GitHub-tracked issues)', () => {
    const resolved = (key: string) => () => ({ projectKey: key, projectName: key, projectPath: `/tmp/${key}` });
    const githubHit = (owner: string, repo: string, number: number) => () => ({
      isGitHub: true as const, owner, repo, prefix: 'X', number,
    });

    it('emits no closing issue for a Linear-tracked project hosted on GitHub (lexerra)', async () => {
      const draft = __testInternals.planStrike('LEX-12', {
        resolveProject: resolved('lexerra'),
        getProject: () => ({ name: 'lexerra', path: '/tmp/lexerra', github_repo: 'eltmon/lexerra', tracker: 'linear', issue_prefix: 'LEX' }),
        // GITHUB_REPOS / github_repo map the LEX prefix to eltmon/lexerra, as live config does.
        resolveGitHubIssue: githubHit('eltmon', 'lexerra', 12),
      });
      expect(draft.closesGithubIssue).toBeUndefined();
      expect(draft.forge).toBe('github');
      expect(draft.githubRepo).toBe('eltmon/lexerra');

      const prompt = __testInternals.buildStrikePrompt(
        await __testInternals.resolveStrikePlan(draft, async () => null),
      );
      expect(prompt).toContain('gh pr create --base main --head strike/lex-12 --repo eltmon/lexerra');
      expect(prompt).not.toContain('Closes #');
      expect(prompt).toContain('Issue: LEX-12');
    });

    it('closes the GitHub issue when the tracker is unset or github and the id maps to the project repo', () => {
      for (const tracker of [undefined, 'github' as const]) {
        const draft = __testInternals.planStrike('PAN-3973', {
          resolveProject: resolved('overdeck'),
          getProject: () => ({ name: 'overdeck', path: '/tmp/overdeck', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN', ...(tracker ? { tracker } : {}) }),
          resolveGitHubIssue: githubHit('eltmon', 'overdeck', 3973),
        });
        expect(draft.closesGithubIssue).toBe(3973);
      }
    });

    it('emits no closing issue when the id resolves to a different repo than the project', () => {
      const draft = __testInternals.planStrike('PAN-3973', {
        resolveProject: resolved('overdeck'),
        getProject: () => ({ name: 'overdeck', path: '/tmp/overdeck', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' }),
        resolveGitHubIssue: githubHit('someone', 'else', 3973),
      });
      expect(draft.closesGithubIssue).toBeUndefined();
    });

    it('takes the forge and base branch from projects.yaml', () => {
      const draft = __testInternals.planStrike('MIN-42', {
        resolveProject: resolved('myn'),
        getProject: () => ({
          name: 'myn', path: '/tmp/myn', gitlab_repo: 'mind-your-now/api', tracker: 'gitlab', issue_prefix: 'MIN',
          workspace: { default_branch: 'develop' },
        }),
        resolveGitHubIssue: () => ({ isGitHub: false }),
      });
      expect(draft.forge).toBe('gitlab');
      expect(draft.baseBranch).toBe('develop');
      expect(draft.gitlabRepo).toBe('mind-your-now/api');
      expect(draft.closesGithubIssue).toBeUndefined();
    });
  });

  describe('resolveStrikePlan', () => {
    const draft = {
      issueId: 'PAN-1',
      workspace: '/tmp/p/workspaces/feature-pan-1-strike',
      branch: 'strike/pan-1',
      sessionName: 'strike-pan-1',
      projectRoot: '/tmp/p',
      forge: null,
      baseBranch: null,
      githubRepo: 'eltmon/p',
      gitlabRepo: 'group/p',
      closesGithubIssue: 1,
    };

    it('reads the forge from origin and the base branch from origin/HEAD when projects.yaml is silent', async () => {
      const plan = await __testInternals.resolveStrikePlan(draft, async (_cwd, command) =>
        command.includes('get-url') ? 'git@gitlab.com:group/p.git' : 'origin/trunk');
      expect(plan.forge).toBe('gitlab');
      expect(plan.baseBranch).toBe('trunk');
      expect(plan.forgeRepo).toBe('group/p');
      // A GitLab origin never takes a GitHub closing keyword.
      expect(plan.closesGithubIssue).toBeUndefined();
    });

    // Review of #4015 (4015-2): a self-hosted GitLab origin is still GitLab.
    it('reads a self-hosted GitLab origin as GitLab', async () => {
      for (const url of [
        'git@gitlab.example.com:group/p.git',
        'https://gitlab.internal.corp/group/p.git',
        'ssh://git@gitlab.example.com:2222/group/p.git',
      ]) {
        const plan = await __testInternals.resolveStrikePlan(draft, async (_cwd, command) =>
          command.includes('get-url') ? url : null);
        expect(plan.forge).toBe('gitlab');
        expect(__testInternals.buildStrikePrompt(plan)).toContain('glab mr create');
      }
    });

    it('falls back to GitHub and main when the repository says nothing', async () => {
      const plan = await __testInternals.resolveStrikePlan(draft, async () => null);
      expect(plan.forge).toBe('github');
      expect(plan.baseBranch).toBe('main');
      expect(plan.forgeRepo).toBe('eltmon/p');
      expect(plan.closesGithubIssue).toBe(1);
    });

    it('does not consult git for what projects.yaml already answered', async () => {
      const git = vi.fn(async () => 'unused');
      const plan = await __testInternals.resolveStrikePlan({ ...draft, forge: 'github', baseBranch: 'release' }, git);
      expect(git).not.toHaveBeenCalled();
      expect(plan.baseBranch).toBe('release');
    });
  });

  it('clears an idle prior strike session so the issue can be struck again', async () => {
    const fakePlan = {
      issueId: 'PAN-2022',
      workspace: '/tmp/feature-pan-2022-strike',
      branch: 'strike/pan-2022',
      sessionName: 'strike-pan-2022',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'idle',
      lastActivity: '2026-06-24T00:00:00.000Z',
    }));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-2022');
  });

  it('clears a prior strike session with no runtime state so the issue can be struck again', async () => {
    const fakePlan = {
      issueId: 'PAN-2058',
      workspace: '/tmp/feature-pan-2058-strike',
      branch: 'strike/pan-2058',
      sessionName: 'strike-pan-2058',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed(null));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-2058');
  });

  it('does not clear an active prior strike session', async () => {
    const fakePlan = {
      issueId: 'PAN-2022',
      workspace: '/tmp/feature-pan-2022-strike',
      branch: 'strike/pan-2022',
      sessionName: 'strike-pan-2022',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'active',
      lastActivity: new Date().toISOString(),
    }));

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).rejects.toThrow(/already running/);

    expect(agentMocks.stopAgent).not.toHaveBeenCalled();
  });

  // PAN-3150: a strike that finished normally leaves its session behind with
  // `active` as its last recorded activity. Refusing on that state alone left
  // the strike namespace with no recovery door for the flywheel, which cannot
  // run `pan kill`.
  it('replaces a terminally resolved strike even when its harness is still alive', async () => {
    const fakePlan = {
      issueId: 'PAN-3586',
      workspace: '/tmp/feature-pan-3586-strike',
      branch: 'strike/pan-3586',
      sessionName: 'strike-pan-3586',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'active',
      resolution: 'abandoned',
      lastActivity: '2026-08-06T20:00:59.000Z',
    }));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(tmuxMocks.isHarnessProcessAlive).not.toHaveBeenCalled();
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-3586');
  });

  it('replaces a stale working strike even when its harness is still alive', async () => {
    const fakePlan = {
      issueId: 'PAN-3586',
      workspace: '/tmp/feature-pan-3586-strike',
      branch: 'strike/pan-3586',
      sessionName: 'strike-pan-3586',
      projectRoot: '/tmp/project',
    };
    const lastActivity = Date.parse('2026-08-06T20:00:25.583Z');
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'active',
      lastActivity: new Date(lastActivity).toISOString(),
    }));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan, lastActivity + (30 * 60 * 1000))).resolves.toBe(true);

    expect(tmuxMocks.isHarnessProcessAlive).not.toHaveBeenCalled();
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-3586');
  });

  it('replaces a completed strike session whose recorded state is fresh but whose harness is gone', async () => {
    const fakePlan = {
      issueId: 'PAN-3150',
      workspace: '/tmp/feature-pan-3150-strike',
      branch: 'strike/pan-3150',
      sessionName: 'strike-pan-3150',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'active',
      lastActivity: new Date().toISOString(),
    }));
    tmuxMocks.isHarnessProcessAlive.mockResolvedValue(false);
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(tmuxMocks.isHarnessProcessAlive).toHaveBeenCalledWith('strike-pan-3150');
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-3150');
  });

  it('does not consult the process tree when the recorded state is already replaceable', async () => {
    const fakePlan = {
      issueId: 'PAN-3150',
      workspace: '/tmp/feature-pan-3150-strike',
      branch: 'strike/pan-3150',
      sessionName: 'strike-pan-3150',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'stopped',
      lastActivity: '2026-07-26T18:47:19.000Z',
    }));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(tmuxMocks.isHarnessProcessAlive).not.toHaveBeenCalled();
  });

  it('replaces a stale strike directory with a registered worktree on the strike branch', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'pan-strike-repo-'));
    const origin = mkdtempSync(join(tmpdir(), 'pan-strike-origin-'));
    git(repo, ['init', '-b', 'main']);
    writeFileSync(join(repo, 'README.md'), 'base\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
    git(origin, ['init', '--bare']);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '-u', 'origin', 'main']);

    const workspace = join(repo, 'workspaces', 'feature-pan-2061-strike');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'stale.txt'), 'not a worktree\n', 'utf8');

    await __testInternals.ensureStrikeWorktree({
      issueId: 'PAN-2061',
      workspace,
      branch: 'strike/pan-2061',
      sessionName: 'strike-pan-2061',
      projectRoot: repo,
      forge: 'github',
      baseBranch: 'main',
    });

    expect(existsSync(join(workspace, 'stale.txt'))).toBe(false);
    expect(readFileSync(join(workspace, '.git'), 'utf8')).toContain('gitdir:');
    expect(git(workspace, ['branch', '--show-current']).trim()).toBe('strike/pan-2061');
    expect(git(repo, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${workspace}\n`);
  });

  it('cuts the strike branch from origin/<base> for a non-main default branch', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'pan-strike-repo-'));
    const origin = mkdtempSync(join(tmpdir(), 'pan-strike-origin-'));
    git(repo, ['init', '-b', 'trunk']);
    writeFileSync(join(repo, 'README.md'), 'base\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
    git(origin, ['init', '--bare']);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '-u', 'origin', 'trunk']);
    const trunkHead = git(repo, ['rev-parse', 'HEAD']).trim();

    const workspace = join(repo, 'workspaces', 'feature-pan-2062-strike');
    await __testInternals.ensureStrikeWorktree({
      issueId: 'PAN-2062',
      workspace,
      branch: 'strike/pan-2062',
      sessionName: 'strike-pan-2062',
      projectRoot: repo,
      forge: 'github',
      baseBranch: 'trunk',
    });

    expect(git(workspace, ['branch', '--show-current']).trim()).toBe('strike/pan-2062');
    expect(git(workspace, ['rev-parse', 'HEAD']).trim()).toBe(trunkHead);
  });
});

/**
 * PAN-4820 WI-6, PAN-4852 WI-16: POST /api/issues/:id/forge-merge bypasses
 * the merge gate, so it runs the repository merge guards (Deft, SageOx) itself
 * on the PR's current head and refuses a PR either guard refuses, before any
 * repo merges. The mocks match merge-ops-polyrepo-completeness.test.ts, which
 * loads the same module.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completePendingOperation: vi.fn(),
  discoverArtifact: vi.fn(),
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  findMergedArtifact: vi.fn(),
  mergeReviewArtifact: vi.fn(),
  mergeSet: null as any,
  postMergeLifecycle: vi.fn(),
  setMergeRun: vi.fn(),
  upsertMergeSet: vi.fn(),
  isDeft: vi.fn(async () => true),
  deftGuard: vi.fn(),
  sageoxGuard: vi.fn(),
  getPrFacts: vi.fn(),
}));

const HEAD = 'dddd444400000000000000000000000000000000';

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
// lib/agents pulls agents/spawn, which imports the removed `state-home`.
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/git-activity.js', () => ({ listGitOperations: vi.fn(() => []) }));
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.exec(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = mocks.exec;
  return {
    exec,
    execFile: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('../../../../../lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
  syncMainIntoWorkspace: vi.fn(),
}));

vi.mock('../../../../../lib/overdeck/merge.js', () => ({
  dequeueMerge: vi.fn(() => null),
  enqueueMerge: vi.fn(() => 1),
  getAllActiveQueues: vi.fn(() => []),
  getCurrentMerge: vi.fn(() => null),
  markMergeProcessing: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  findProjectByTeam: vi.fn(() => ({
    workspace: {
      type: 'polyrepo',
      repos: [
        { name: 'repo-a', path: 'repo-a' },
        { name: 'repo-b', path: 'repo-b' },
      ],
    },
    quality_gates: {},
  })),
  findProjectByPath: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/project' })),
}));

// PAN-3917: merge readiness is the forge's answer, not a review-status record.
vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(async (issueId: string) => ({
    issueId,
    state: 'ready',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/1', number: 1, reviewState: 'approved', checks: 'green', mergeable: true },
  })),
}));

vi.mock('../../../../../lib/tmux.js', () => ({
  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
  sessionExists: vi.fn(),
}));

vi.mock('../../workspaces.js', () => ({
  completePendingOperation: mocks.completePendingOperation,
  getPendingOperation: vi.fn(() => null),
  getProjectPath: vi.fn(() => '/project'),
  getWorkspaceInfoForIssue: vi.fn(() => ({ isRemote: false, localPath: '/workspace' })),
  readJsonBody: vi.fn(),
  setPendingOperation: vi.fn(),
}));

vi.mock('../merge-strike.js', () => ({
  activeStrikeMerge: vi.fn(() => false),
  advanceMergeQueue: vi.fn(async () => {}),
  ensureAgentReadyForMerge: vi.fn(),
  automaticMergeHead: vi.fn(() => null),
  automaticMergePin: vi.fn(() => ({})),
  manualMergeHeadMoved: vi.fn(() => null),
  mergeHeadPin: vi.fn(() => ({})),
  automaticMergeStartRefusal: vi.fn(async () => null),
  busyMergeRefusal: vi.fn(() => null),
  forgeMergeGate: vi.fn(async () => ({ refusal: null, facts: { headBranch: 'feature/pan-1', url: null } })),
  forgeMergeGateRefusal: vi.fn(async () => null),
  mergeTargetRefusal: vi.fn(() => null),
  mergeVerificationOptions: vi.fn(() => ({})),
  normalMergeEligibility: vi.fn(() => null),
  validateStrikeMergeRequest: vi.fn(() => null),
}));

vi.mock('../../specialists.js', () => ({
  _serverManagedMerges: new Set<string>(),
}));

vi.mock('../../../services/merge-queue-service.js', () => ({
  setMergeQueueAdvanceHandler: vi.fn(),
  setMergeRun: (issueId: string, patch: Record<string, unknown>) => mocks.setMergeRun(issueId, patch),
  getMergeRun: () => null,
  clearMergeRun: vi.fn(),
}));

vi.mock('../../../../../lib/merge-set.js', () => ({
  ensureMergeSetForIssue: vi.fn(() => mocks.mergeSet),
  getMergeSet: vi.fn(() => mocks.mergeSet),
  upsertMergeSet: (mergeSet: any) => {
    mocks.mergeSet = mergeSet;
    mocks.upsertMergeSet(mergeSet);
  },
  withRepoArtifactUrl: vi.fn((mergeSet: any, repoKey: string, artifactUrl: string, artifactId?: string) => ({
    ...mergeSet,
    repos: mergeSet.repos.map((repo: any) => (
      repo.repoKey === repoKey ? { ...repo, artifactUrl, artifactId } : repo
    )),
  })),
  withRepoState: vi.fn((mergeSet: any, repoKey: string, patch: Record<string, unknown>) => ({
    ...mergeSet,
    repos: mergeSet.repos.map((repo: any) => (
      repo.repoKey === repoKey ? { ...repo, ...patch } : repo
    )),
  })),
}));

vi.mock('../../../../../lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({
    discoverArtifact: mocks.discoverArtifact,
    findMergedArtifact: mocks.findMergedArtifact,
    mergeReviewArtifact: mocks.mergeReviewArtifact,
  })),
}));

vi.mock('../../../../../lib/deft/issue-pipeline.js', () => ({
  isDeftPipelineIssue: (issueId: string) => mocks.isDeft(issueId),
}));

vi.mock('../../../../../lib/deft/merge-guard.js', () => ({
  deftMergeGuardForIssue: (issueId: string, headSha: string | null) => mocks.deftGuard(issueId, headSha),
}));

vi.mock('../../../../../lib/sageox/merge-guard.js', () => ({
  sageoxMergeGuardForIssue: (issueId: string, headSha: string | null, headBranch: string | null) =>
    mocks.sageoxGuard(issueId, headSha, headBranch),
}));

vi.mock('../../../../../lib/cloister/pr-facts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../../lib/cloister/pr-facts.js')>(),
  getPrFacts: (issueId: string) => mocks.getPrFacts(issueId),
}));

import { mergeOpsRouteLayer } from '../merge-ops.js';

async function forgeMerge(issueId: string): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/forge-merge`, { method: 'POST' }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeOpsRouteLayer), (app) => app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      )),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const set = {
  issueId: 'PAN-1',
  projectKey: 'overdeck',
  projectPath: '/project',
  workspaceType: 'monorepo',
  status: 'ready',
  createdAt: '2026-11-02T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  repos: [{
    repoKey: 'overdeck',
    repoPath: '/project',
    forge: 'github',
    sourceBranch: 'feature/pan-1',
    targetBranch: 'main',
    artifactUrl: 'https://github.com/eltmon/overdeck/pull/1',
    artifactId: '1',
    repoMerge: 'pending',
    required: true,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mergeSet = structuredClone(set);
  mocks.isDeft.mockResolvedValue(true);
  mocks.sageoxGuard.mockResolvedValue({ ok: true });
  mocks.getPrFacts.mockResolvedValue({ headSha: HEAD, headBranch: 'feature/pan-1' });
  mocks.mergeReviewArtifact.mockResolvedValue(undefined);
});

describe('POST /api/issues/:issueId/forge-merge for a Deft issue', () => {
  it('refuses with 409 and refused true when the guard refuses, and merges nothing', async () => {
    mocks.deftGuard.mockResolvedValue({ ok: false, reason: 'PR contains Deft install paths: .githooks/pre-push', paths: ['.githooks/pre-push'], drifted: [] });

    const result = await forgeMerge('PAN-1');

    expect(result).toEqual({
      status: 409,
      body: { error: 'Cannot merge: PR contains Deft install paths: .githooks/pre-push', refused: true },
    });
    expect(mocks.deftGuard).toHaveBeenCalledWith('PAN-1', HEAD);
    expect(mocks.sageoxGuard).not.toHaveBeenCalled();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('passes a null head to the Deft guard, which resolves it itself, when the forge reports none', async () => {
    mocks.getPrFacts.mockResolvedValue({ headSha: null, headBranch: null });
    mocks.deftGuard.mockResolvedValue({ ok: false, reason: "merge guard could not read the PR's changed files: no PR head", paths: [], drifted: [] });

    const result = await forgeMerge('PAN-1');

    expect(result.status).toBe(409);
    expect(mocks.deftGuard).toHaveBeenCalledWith('PAN-1', null);
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('merges when the guard passes', async () => {
    mocks.deftGuard.mockResolvedValue({ ok: true, drifted: [] });

    await forgeMerge('PAN-1');

    expect(mocks.mergeReviewArtifact).toHaveBeenCalledTimes(1);
  });

  it('does not run the guard for an Overdeck issue', async () => {
    mocks.isDeft.mockResolvedValue(false);

    await forgeMerge('PAN-1');

    expect(mocks.deftGuard).not.toHaveBeenCalled();
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/issues/:issueId/forge-merge and the SageOx guard', () => {
  beforeEach(() => {
    mocks.isDeft.mockResolvedValue(false);
  });

  it('refuses with 409 when the PR carries .sageox/ link files the project has not opted in to, and merges nothing', async () => {
    const reason = 'PR changes SageOx link files (.sageox/) but overdeck has not opted in to committing them; remove them from the PR or run pan skills pack sageox commit --project overdeck';
    mocks.sageoxGuard.mockResolvedValue({ ok: false, reason, paths: ['.sageox/config.json'] });

    const result = await forgeMerge('PAN-1');

    expect(result).toEqual({ status: 409, body: { error: `Cannot merge: ${reason}`, refused: true } });
    expect(mocks.sageoxGuard).toHaveBeenCalledWith('PAN-1', HEAD, 'feature/pan-1');
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('merges when the SageOx guard passes', async () => {
    await forgeMerge('PAN-1');

    expect(mocks.sageoxGuard).toHaveBeenCalledTimes(1);
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledTimes(1);
  });
});

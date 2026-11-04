/**
 * PAN-4852 WI-16: every merge door runs the repository merge guards (Deft,
 * SageOx) through one `evaluateRepoMergeGuards` call. Forge facts, reviews,
 * the Deft pipeline read and both guards are injected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateIssueMergeGate, type MergeGateDeps } from '../merge-gate.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';
import { evaluateRepoMergeGuards, type RepoGuardDeps } from '../repo-merge-guards.js';

const { sageoxGuard } = vi.hoisted(() => ({ sageoxGuard: vi.fn() }));
vi.mock('../../sageox/merge-guard.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../sageox/merge-guard.js')>(),
  sageoxMergeGuardForIssue: sageoxGuard,
}));

const HEAD = 'dddd444400000000000000000000000000000000';
const BRANCH = 'feature/pan-1';
const SAGEOX_REASON = 'PR changes SageOx link files (.sageox/) but overdeck has not opted in to committing them; remove them from the PR or run pan skills pack sageox commit --project overdeck';

/** Open, green, mergeable and approved at the head. */
function readyFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    exists: true,
    open: true,
    headSha: HEAD,
    headBranch: BRANCH,
    reviewDecision: 'APPROVED',
    approved: true,
    approvedAtHead: true,
    mergeable: true,
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
    ...overrides,
  };
}

function gateDeps(facts: PrFacts, extra: Partial<MergeGateDeps> = {}): MergeGateDeps {
  return {
    getFacts: async () => facts,
    readReviews: async () => ({ headRefOid: HEAD, reviews: [] }),
    overdeckLogins: async () => ['overdeck-agent[bot]'],
    ciTestsRequired: () => true,
    uatRequired: async () => false,
    isDeftPipeline: async () => false,
    ...extra,
  };
}

/** The gate with both repo guards injected. */
function withGuards(facts: PrFacts, guards: RepoGuardDeps): MergeGateDeps {
  return gateDeps(facts, { repoGuards: (issueId, guardFacts) => evaluateRepoMergeGuards(issueId, guardFacts, guards) });
}

const sageoxRefuses = vi.fn(async () => ({ ok: false as const, reason: SAGEOX_REASON, paths: ['.sageox/config.json'] }));
const sageoxPasses = vi.fn(async () => ({ ok: true as const }));
const notDeft = vi.fn(async () => null);

beforeEach(() => {
  vi.clearAllMocks();
  sageoxGuard.mockResolvedValue({ ok: true });
});

describe('evaluateIssueMergeGate with the repo merge guards', () => {
  it('refuses a green, approved, mergeable PR the SageOx guard refuses, with the SageOx reason', async () => {
    const result = await evaluateIssueMergeGate('PAN-1', withGuards(readyFacts(), { deft: notDeft, sageox: sageoxRefuses }));

    expect(result).toMatchObject({ ready: false, reason: SAGEOX_REASON });
    expect(result).not.toHaveProperty('deftDrift');
    expect(sageoxRefuses).toHaveBeenCalledWith('PAN-1', HEAD, BRANCH);
  });

  it('reports the Deft refusal when both guards refuse, and never runs SageOx', async () => {
    const deft = vi.fn(async () => ({ ok: false, reason: 'PR contains Deft install paths: .githooks/pre-push', drifted: ['package.json'] }));

    const result = await evaluateIssueMergeGate('PAN-1', withGuards(readyFacts(), { deft, sageox: sageoxRefuses }));

    expect(result).toMatchObject({
      ready: false,
      reason: 'PR contains Deft install paths: .githooks/pre-push',
      deftDrift: ['package.json'],
    });
    expect(sageoxRefuses).not.toHaveBeenCalled();
  });

  it('leaves the readiness unchanged when both guards pass', async () => {
    const baseline = await evaluateIssueMergeGate('PAN-1', gateDeps(readyFacts(), { repoGuards: async () => ({ ok: true }) }));
    const result = await evaluateIssueMergeGate('PAN-1', withGuards(readyFacts(), {
      deft: async () => ({ ok: true, drifted: [] }),
      sageox: sageoxPasses,
    }));

    expect(result.ready).toBe(true);
    expect(result).toEqual(baseline);
    expect(sageoxPasses).toHaveBeenCalledTimes(1);
  });

  it('never calls the guards for a not-ready PR of an Overdeck issue', async () => {
    const repoGuards = vi.fn(async () => ({ ok: true as const }));

    const result = await evaluateIssueMergeGate('PAN-1', gateDeps(readyFacts({ checks: 'red', testChecks: 'red' }), { repoGuards }));

    expect(result.ready).toBe(false);
    expect(repoGuards).not.toHaveBeenCalled();
  });

  it('still runs the Deft guard for a not-ready Deft PR (PAN-4820), but never SageOx', async () => {
    const deftGuard = vi.fn(async () => ({ ok: false as const, reason: 'drift', paths: ['package.json'], drifted: ['package.json'] }));

    const result = await evaluateIssueMergeGate('PAN-1', gateDeps(readyFacts({ checks: 'red', testChecks: 'red' }), {
      isDeftPipeline: async () => true,
      deftGuard,
    }));

    expect(result).toMatchObject({ ready: false, reason: 'drift', deftDrift: ['package.json'] });
    expect(deftGuard).toHaveBeenCalledWith('PAN-1', HEAD);
    expect(sageoxGuard).not.toHaveBeenCalled();
  });

  it('keeps the readiness reason for a not-ready Deft PR the Deft guard passes', async () => {
    const result = await evaluateIssueMergeGate('PAN-1', gateDeps(readyFacts({ checks: 'red', testChecks: 'red' }), {
      isDeftPipeline: async () => true,
      deftGuard: async () => ({ ok: true, drifted: [] }),
    }));

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/CI checks failing/);
    expect(sageoxGuard).not.toHaveBeenCalled();
  });

  it('runs the SageOx guard by default on an otherwise-ready PR, with its head and branch', async () => {
    sageoxGuard.mockResolvedValue({ ok: false, reason: SAGEOX_REASON, paths: ['.sageox/config.json'] });

    const result = await evaluateIssueMergeGate('PAN-1', gateDeps(readyFacts()));

    expect(result).toMatchObject({ ready: false, reason: SAGEOX_REASON });
    expect(sageoxGuard).toHaveBeenCalledWith('PAN-1', HEAD, BRANCH);
  });

  it('refuses a PR adding .sageox/config.json until the project records a committed binding', async () => {
    const { sageoxMergeGuardForIssue } = await vi.importActual<typeof import('../../sageox/merge-guard.js')>('../../sageox/merge-guard.js');
    let committed = false;
    const sageox: RepoGuardDeps['sageox'] = (issueId, headSha, headBranch) => sageoxMergeGuardForIssue(issueId, headSha, headBranch, {
      resolveProject: () => ({ projectKey: 'overdeck', projectPath: '/project', config: null }),
      workspacePath: () => '/workspace',
      isGitWorkTree: async () => true,
      readCommitted: async () => committed,
      defaultBranchTracks: async () => false,
      readChangedPaths: async () => ['.sageox/config.json'],
    });

    const refused = await evaluateIssueMergeGate('PAN-1', withGuards(readyFacts(), { deft: notDeft, sageox }));
    committed = true;
    const allowed = await evaluateIssueMergeGate('PAN-1', withGuards(readyFacts(), { deft: notDeft, sageox }));

    expect(refused).toMatchObject({ ready: false, reason: SAGEOX_REASON });
    expect(allowed.ready).toBe(true);
  });
});

describe('evaluateRepoMergeGuards', () => {
  it('passes the Deft drift through, including an empty list', async () => {
    const verdict = await evaluateRepoMergeGuards('PAN-1', { headSha: HEAD, headBranch: BRANCH }, {
      deft: async () => ({ ok: false, reason: 'PR contains Deft install paths: .deft/x', drifted: [] }),
      sageox: sageoxPasses,
    });

    expect(verdict).toEqual({ ok: false, reason: 'PR contains Deft install paths: .deft/x', deftDrift: [] });
  });

  it('runs only the Deft guard when the PR is not otherwise ready', async () => {
    const deft = vi.fn(async () => ({ ok: true }));

    const verdict = await evaluateRepoMergeGuards('PAN-1', { headSha: HEAD, headBranch: BRANCH, otherwiseReady: false }, {
      deft,
      sageox: sageoxRefuses,
    });

    expect(verdict).toEqual({ ok: true });
    expect(deft).toHaveBeenCalledWith('PAN-1', HEAD);
    expect(sageoxRefuses).not.toHaveBeenCalled();
  });

  it('runs SageOx when readiness is not given (the forge-merge door) and fails closed on a null head', async () => {
    const sageox = vi.fn(async () => ({ ok: false as const, reason: "SageOx merge guard could not read the PR's changed files: no PR head; fetch the PR head in /workspace", paths: [] }));

    const verdict = await evaluateRepoMergeGuards('PAN-1', { headSha: null, headBranch: null }, { deft: notDeft, sageox });

    expect(verdict).toMatchObject({ ok: false });
    expect(sageox).toHaveBeenCalledWith('PAN-1', null, null);
  });
});

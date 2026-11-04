/**
 * PAN-4970: the one merge-path owner per ready feature. Every dependency is
 * injected — no `vi.mock` — so each test drives exactly the rule it names.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type { PendingAutoMerge, PendingAutoMergeStatus } from '../../../../lib/overdeck/merge-sync.js';
import { mergePathOwner, perPrTrainActiveForProject, type MergePathOwnerDeps } from '../merge-path-owner.js';

const PROJECT_PATH = '/repos/overdeck';
const ISSUE_ID = 'PAN-4970';
const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';

const GITHUB_MONOREPO: ProjectConfig = { name: 'Overdeck', path: PROJECT_PATH };
const POLYREPO: ProjectConfig = { name: 'Poly', path: PROJECT_PATH, workspace: { type: 'polyrepo' } };

function row(status: PendingAutoMergeStatus, overrides: Partial<PendingAutoMerge> = {}): PendingAutoMerge {
  return {
    id: 1,
    issueId: ISSUE_ID,
    prUrl: PR_URL,
    projectKey: 'overdeck',
    forge: 'github',
    status,
    scheduledMergeAt: '2026-11-04T00:00:00Z',
    scheduledAt: '2026-11-04T00:00:00Z',
    headSha: 'abc123',
    ...overrides,
  };
}

function deps(overrides: MergePathOwnerDeps = {}): MergePathOwnerDeps {
  return {
    env: {},
    forgeOf: () => 'github',
    latestAutoMerge: () => null,
    policyRefusal: () => null,
    deftHold: async () => null,
    prOf: async () => ({ url: PR_URL, headSha: 'abc123' }),
    ...overrides,
  };
}

describe('mergePathOwner', () => {
  // owner-rule.ac1
  it('returns per-pr for a pending or merging row in a GitHub monorepo, and for the same row in GitLab or polyrepo', async () => {
    for (const status of ['pending', 'merging'] as const) {
      const d = deps({ latestAutoMerge: () => row(status) });
      await expect(mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, d)).resolves.toBe('per-pr');
      await expect(
        mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, deps({ ...d, forgeOf: () => 'gitlab' })),
      ).resolves.toBe('per-pr');
      await expect(mergePathOwner(ISSUE_ID, PROJECT_PATH, POLYREPO, d)).resolves.toBe('per-pr');
    }
  });

  // owner-rule.ac2
  it('rules 1-3 override a pending row: kill switch, policy refusal, and Deft hold all force batch', async () => {
    const pending = row('pending');

    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({ latestAutoMerge: () => pending, env: { OVERDECK_DISABLE_AUTO_MERGE: '1' } }),
      ),
    ).resolves.toBe('batch');

    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({ latestAutoMerge: () => pending, env: {} }),
      ),
    ).resolves.toBe('per-pr');

    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({
          latestAutoMerge: () => pending,
          policyRefusal: () => ({ status: 412, body: { error: 'UAT is still required before merge' } }),
        }),
      ),
    ).resolves.toBe('batch');

    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({ latestAutoMerge: () => pending, deftHold: async () => `${ISSUE_ID} runs on Deft` }),
      ),
    ).resolves.toBe('batch');
  });

  // owner-rule.ac3
  it('batches a GitLab forge, a polyrepo config, or a cancelled row with no active row; per-pr for merged or no row', async () => {
    await expect(
      mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, deps({ forgeOf: () => 'gitlab' })),
    ).resolves.toBe('batch');

    await expect(mergePathOwner(ISSUE_ID, PROJECT_PATH, POLYREPO, deps())).resolves.toBe('batch');

    await expect(
      mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, deps({ latestAutoMerge: () => row('cancelled') })),
    ).resolves.toBe('batch');

    await expect(
      mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, deps({ latestAutoMerge: () => row('merged') })),
    ).resolves.toBe('per-pr');

    await expect(
      mergePathOwner(ISSUE_ID, PROJECT_PATH, GITHUB_MONOREPO, deps({ latestAutoMerge: () => null })),
    ).resolves.toBe('per-pr');
  });

  // owner-rule.ac4
  it('re-arms a failed/blocked row only at a new PR head', async () => {
    // failed at the same head as the current PR => batch.
    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({
          latestAutoMerge: () => row('failed', { headSha: 'abc123' }),
          prOf: async () => ({ url: PR_URL, headSha: 'abc123' }),
        }),
      ),
    ).resolves.toBe('batch');

    // failed with no recorded head => batch, can't tell old from new.
    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({
          latestAutoMerge: () => row('failed', { headSha: undefined }),
          prOf: async () => ({ url: PR_URL, headSha: 'abc123' }),
        }),
      ),
    ).resolves.toBe('batch');

    // failed, but the PR head moved on => per-pr, the push re-arms it.
    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({
          latestAutoMerge: () => row('failed', { headSha: 'abc123' }),
          prOf: async () => ({ url: PR_URL, headSha: 'def456' }),
        }),
      ),
    ).resolves.toBe('per-pr');

    // blocked at the same head => per-pr, the gate passing now clears the block.
    await expect(
      mergePathOwner(
        ISSUE_ID,
        PROJECT_PATH,
        GITHUB_MONOREPO,
        deps({
          latestAutoMerge: () => row('blocked', { headSha: 'abc123' }),
          prOf: async () => ({ url: PR_URL, headSha: 'abc123' }),
        }),
      ),
    ).resolves.toBe('per-pr');
  });

  it('upper-cases the issue id before every dependency call', async () => {
    const seen: string[] = [];
    await mergePathOwner(
      'pan-4970',
      PROJECT_PATH,
      GITHUB_MONOREPO,
      deps({
        policyRefusal: (id) => {
          seen.push(id);
          return null;
        },
        deftHold: async (id) => {
          seen.push(id);
          return null;
        },
        latestAutoMerge: (id) => {
          seen.push(id);
          return null;
        },
      }),
    );
    expect(seen).toEqual([ISSUE_ID, ISSUE_ID, ISSUE_ID]);
  });
});

describe('perPrTrainActiveForProject', () => {
  it('is false when the kill switch is set, the forge is GitLab, or the workspace is polyrepo', async () => {
    await expect(
      perPrTrainActiveForProject(PROJECT_PATH, GITHUB_MONOREPO, deps({ env: { OVERDECK_DISABLE_AUTO_MERGE: '1' } })),
    ).resolves.toBe(false);
    await expect(
      perPrTrainActiveForProject(PROJECT_PATH, GITHUB_MONOREPO, deps({ forgeOf: () => 'gitlab' })),
    ).resolves.toBe(false);
    await expect(perPrTrainActiveForProject(PROJECT_PATH, POLYREPO, deps())).resolves.toBe(false);
  });

  it('is true for an unheld GitHub, single-repo project', async () => {
    await expect(perPrTrainActiveForProject(PROJECT_PATH, GITHUB_MONOREPO, deps())).resolves.toBe(true);
  });
});

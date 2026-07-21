import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// PAN-2555: release/publish pipeline status for the Command Deck.

// OVERDECK_HOME is resolved at module load (src/lib/paths.ts), so it must be
// set before the first dynamic import of project-pipelines.js.
const TEST_HOME = join(tmpdir(), `pipelines-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const NPM_PROJECT = join(TEST_HOME, 'projects', 'shipper');
const PLAIN_PROJECT = join(TEST_HOME, 'projects', 'plain');

beforeAll(() => {
  mkdirSync(join(NPM_PROJECT, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(NPM_PROJECT, '.github', 'workflows', 'release.yml'), 'on: push\n');
  writeFileSync(join(NPM_PROJECT, 'package.json'), JSON.stringify({ name: '@acme/shipper', version: '1.0.0' }));
  mkdirSync(PLAIN_PROJECT, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    [
      'projects:',
      '  shipper:',
      '    name: Shipper',
      `    path: ${NPM_PROJECT}`,
      '    github_repo: acme/shipper',
      '  plain:',
      '    name: Plain',
      `    path: ${PLAIN_PROJECT}`,
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

const GH_FIXTURES: Record<string, unknown> = {
  'repos/acme/shipper/actions/workflows/release.yml/runs?per_page=5': {
    workflow_runs: [
      {
        id: 42,
        display_title: 'chore: release 1.0.1',
        head_branch: 'v1.0.1',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/acme/shipper/actions/runs/42',
        created_at: '2026-07-12T00:00:00Z',
        updated_at: '2026-07-12T00:20:00Z',
      },
    ],
  },
  'repos/acme/shipper/actions/runs/42/jobs?per_page=100': {
    jobs: [
      { name: 'npm', status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/shipper/actions/runs/42/job/1' },
      { name: 'desktop (mac)', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/acme/shipper/actions/runs/42/job/2' },
      { name: 'release', status: 'completed', conclusion: 'skipped', html_url: null },
    ],
  },
  'repos/acme/shipper/releases/latest': {
    tag_name: 'v1.0.0',
    html_url: 'https://github.com/acme/shipper/releases/tag/v1.0.0',
  },
};

const ghApi = async (path: string) => {
  const fixture = GH_FIXTURES[path];
  if (!fixture) throw new Error(`unexpected gh api path: ${path}`);
  return fixture;
};

describe('fetchProjectReleaseStatus', () => {
  it('reports runs, job-level detail (partial failure shape), release, and npm dist-tag', async () => {
    const { fetchProjectReleaseStatus } = await import('../project-pipelines.js');
    const result = await fetchProjectReleaseStatus('shipper', {
      ghApi,
      fetchJson: async () => ({ latest: '1.0.1' }),
    });

    expect(result.available).toBe(true);
    expect(result.repo).toBe('acme/shipper');
    expect(result.releaseWorkflow).toBe('release.yml');
    expect(result.runs[0]).toMatchObject({ id: 42, tag: 'v1.0.1', conclusion: 'failure' });
    // Job detail is what makes an npm-✓/desktop-✕/Release-skipped partial
    // failure distinguishable from a clean success (AC-3).
    expect(result.latestRunJobs.map((job) => [job.name, job.conclusion])).toEqual([
      ['npm', 'success'],
      ['desktop (mac)', 'failure'],
      ['release', 'skipped'],
    ]);
    expect(result.githubRelease).toEqual({ tagName: 'v1.0.0', htmlUrl: 'https://github.com/acme/shipper/releases/tag/v1.0.0' });
    // Inferred from the project package.json name (not private).
    expect(result.npmPackages).toEqual([
      { name: '@acme/shipper', latestVersion: '1.0.1', url: 'https://www.npmjs.com/package/@acme/shipper' },
    ]);
  });

  it('resolves by display name too (the deck sends names)', async () => {
    const { fetchProjectReleaseStatus } = await import('../project-pipelines.js');
    const result = await fetchProjectReleaseStatus('Shipper', { ghApi, fetchJson: async () => ({ latest: '1.0.1' }) });
    expect(result.available).toBe(true);
    expect(result.projectKey).toBe('shipper');
  });

  it('tolerates an unreachable npm registry (AC: never an error)', async () => {
    const { fetchProjectReleaseStatus } = await import('../project-pipelines.js');
    const result = await fetchProjectReleaseStatus('shipper', {
      ghApi,
      fetchJson: async () => { throw new Error('HTTP 503'); },
    });
    expect(result.available).toBe(true);
    expect(result.npmPackages[0]).toMatchObject({ name: '@acme/shipper', latestVersion: null, error: 'HTTP 503' });
  });

  it('reports no-publish-pipeline projects as unavailable with a reason (AC-4)', async () => {
    const { fetchProjectReleaseStatus } = await import('../project-pipelines.js');
    const result = await fetchProjectReleaseStatus('plain', { ghApi, fetchJson: async () => ({}) });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('No publish pipeline');
  });

  it('reports unknown projects as unavailable, not an error', async () => {
    const { fetchProjectReleaseStatus } = await import('../project-pipelines.js');
    const result = await fetchProjectReleaseStatus('nope', { ghApi, fetchJson: async () => ({}) });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Unknown project');
  });
});

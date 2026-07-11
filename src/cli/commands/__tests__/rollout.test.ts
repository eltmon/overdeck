import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getReleaseSetSync: vi.fn(),
  runRelease: vi.fn(),
  parseIssueIdSync: vi.fn((id: string) => ({ prefix: id.split('-')[0], numeric: Number(id.split('-')[1]), issueId: id })),
  resolveIssueIdSync: vi.fn((id: string) => id.toUpperCase()),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/repo/overdeck' })),
}));

vi.mock('../../../lib/release-set.js', () => ({
  getReleaseSetSync: mocks.getReleaseSetSync,
}));

vi.mock('../../../lib/release/release-engine.js', () => ({
  runRelease: mocks.runRelease,
}));

vi.mock('../../../lib/issue-id.js', () => ({
  parseIssueIdSync: mocks.parseIssueIdSync,
  resolveIssueIdSync: mocks.resolveIssueIdSync,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

import { rolloutStatusCommand, rolloutRetryCommand } from '../rollout.js';

function makeReleaseSet(overrides: Partial<ReturnType<typeof mocks.getReleaseSetSync>> = {}): NonNullable<ReturnType<typeof mocks.getReleaseSetSync>> {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'passed',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    components: [
      { componentKey: 'api', trigger: 'auto', releaseOrder: 0, required: true, status: 'passed' },
      { componentKey: 'frontend', trigger: 'auto', releaseOrder: 1, required: true, status: 'passed' },
    ],
    ...overrides,
  } as NonNullable<ReturnType<typeof mocks.getReleaseSetSync>>;
}

describe('rollout status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    }) as never);
  });

  it('prints release status and component rows', async () => {
    mocks.getReleaseSetSync.mockReturnValue(makeReleaseSet());

    await rolloutStatusCommand('PAN-399');

    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('Release status: passed');
    expect(output).toContain('api');
    expect(output).toContain('frontend');
    expect(output).toContain('order=0');
    expect(output).toContain('order=1');
  });

  it('exits when the issue ID is invalid', async () => {
    mocks.parseIssueIdSync.mockReturnValueOnce(null);

    await expect(rolloutStatusCommand('BAD')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  it('exits when no project is configured', async () => {
    mocks.resolveProjectFromIssueSync.mockReturnValueOnce(null);

    await expect(rolloutStatusCommand('PAN-399')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  it('canonicalizes lowercase issue IDs for status lookup', async () => {
    mocks.getReleaseSetSync.mockReturnValue(makeReleaseSet());

    await rolloutStatusCommand('pan-399');

    expect(mocks.resolveIssueIdSync).toHaveBeenCalledWith('pan-399');
    expect(mocks.getReleaseSetSync).toHaveBeenCalledWith('PAN-399');
  });
});

describe('rollout retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    }) as never);
  });

  it('re-runs the release engine and prints the result', async () => {
    mocks.runRelease.mockResolvedValue(makeReleaseSet({ status: 'releasing' }));

    await rolloutRetryCommand('PAN-399');

    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-399', '/repo/overdeck');
    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('Release status: releasing');
  });

  it('prints a skip message when no release config exists', async () => {
    mocks.runRelease.mockResolvedValue(null);

    await rolloutRetryCommand('PAN-399');

    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('no release config');
  });

  it('canonicalizes lowercase issue IDs for retry', async () => {
    mocks.runRelease.mockResolvedValue(makeReleaseSet({ status: 'releasing' }));

    await rolloutRetryCommand('pan-399');

    expect(mocks.resolveIssueIdSync).toHaveBeenCalledWith('pan-399');
    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-399', '/repo/overdeck');
  });
});

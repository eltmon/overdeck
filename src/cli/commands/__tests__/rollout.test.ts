import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  getReleaseSetSync: vi.fn(),
  getMergeSetSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  runRelease: vi.fn(),
}));

vi.mock('../../../lib/release-set.js', () => ({
  getReleaseSetSync: mocks.getReleaseSetSync,
}));

vi.mock('../../../lib/merge-set.js', () => ({
  getMergeSetSync: mocks.getMergeSetSync,
}));

vi.mock('../../../lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

vi.mock('../../../lib/release/release-engine.js', () => ({
  runRelease: mocks.runRelease,
}));

import { registerRolloutCommands, rolloutRetryCommand, rolloutStatusCommand } from '../rollout.js';

function makeReleaseSet(overrides: Record<string, unknown> = {}) {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'partial',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    components: [
      { componentKey: 'api', releaseOrder: 0, status: 'passed', trigger: 'auto', required: true },
      { componentKey: 'frontend', releaseOrder: 1, status: 'failed', trigger: 'auto', required: true },
    ],
    ...overrides,
  };
}

describe('rollout CLI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getReviewStatusSync.mockReturnValue({ releaseStatus: 'partial' });
    process.exitCode = undefined;
  });

  it('prints release status and ordered component states', async () => {
    mocks.getReleaseSetSync.mockReturnValue(makeReleaseSet());

    await rolloutStatusCommand('pan-399');

    expect(logSpy).toHaveBeenCalledWith('PAN-399 releaseStatus: partial');
    expect(logSpy).toHaveBeenCalledWith('0. api: passed');
    expect(logSpy).toHaveBeenCalledWith('1. frontend: failed');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('retries using the existing release set project path', async () => {
    mocks.getReleaseSetSync.mockReturnValue(makeReleaseSet({ status: 'passed' }));
    mocks.runRelease.mockResolvedValue(makeReleaseSet({ status: 'passed' }));
    mocks.getReviewStatusSync.mockReturnValue({ releaseStatus: 'passed' });

    await rolloutRetryCommand('pan-399');

    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-399', '/repo/overdeck');
    expect(logSpy).toHaveBeenCalledWith('PAN-399 releaseStatus: passed');
  });

  it('retries using the merge set project path when no release set exists yet', async () => {
    mocks.getReleaseSetSync.mockReturnValue(null);
    mocks.getMergeSetSync.mockReturnValue({ projectPath: '/repo/from-merge-set' });
    mocks.runRelease.mockResolvedValue(makeReleaseSet({ projectPath: '/repo/from-merge-set' }));

    await rolloutRetryCommand('PAN-399');

    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-399', '/repo/from-merge-set');
  });

  it('registers pan rollout status and retry subcommands', () => {
    const program = new Command();
    registerRolloutCommands(program);

    const rollout = program.commands.find(command => command.name() === 'rollout');
    expect(rollout?.commands.map(command => command.name())).toEqual(['status', 'retry']);
  });
});

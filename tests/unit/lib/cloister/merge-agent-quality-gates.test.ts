import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

// Mock dependencies before importing the module under test
vi.mock('../../../../src/lib/projects.js', () => ({
  loadProjectsConfig: vi.fn(),
  loadProjectsConfigSync: vi.fn(),
  resolveProjectFromIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findProjectByTeam: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  runMergeValidation: vi.fn(),
  autoRevertMerge: vi.fn(),
  runQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sendKeysAsync: vi.fn(),
  sessionExists: vi.fn(),
  sessionExistsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-log.js', () => ({
  logActivity: vi.fn(),
}));

import { runProjectQualityGates } from '../../../../src/lib/cloister/merge-agent.js';
import { loadProjectsConfigSync } from '../../../../src/lib/projects.js';
import { runQualityGates } from '../../../../src/lib/cloister/validation.js';

const mockLoadProjectsConfig = vi.mocked(loadProjectsConfigSync);
const mockRunQualityGates = vi.mocked(runQualityGates);

const PROJECT_PATH = '/home/user/projects/myapp';
const PASSING_GATE_RESULT = [{ name: 'lint', passed: true, required: true, output: '' }];

describe('runProjectQualityGates — polyrepo path filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunQualityGates.mockReturnValue(Effect.succeed(PASSING_GATE_RESULT) as any);
  });

  it('runs all gates in monorepo context (repoRelPath is empty)', async () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: PROJECT_PATH,
          quality_gates: {
            lint: { command: 'pnpm lint', required: true },
            typecheck: { command: 'pnpm typecheck', required: true },
          },
        },
      },
    } as any);

    // projectPath === project.path → monorepo
    const results = await runProjectQualityGates(PROJECT_PATH, 'pre_push');

    expect(mockRunQualityGates).toHaveBeenCalledOnce();
    const [gatesArg] = mockRunQualityGates.mock.calls[0];
    expect(Object.keys(gatesArg)).toEqual(['lint', 'typecheck']);
    expect(results).toEqual(PASSING_GATE_RESULT);
  });

  it('runs only matching gates in polyrepo context', async () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: PROJECT_PATH,
          quality_gates: {
            'fe-lint': { command: 'pnpm lint', path: 'frontend', required: true },
            'api-lint': { command: './mvnw checkstyle:check', path: 'backend', required: true },
          },
        },
      },
    } as any);

    // projectPath is the frontend sub-repo → repoRelPath = 'frontend'
    const results = await runProjectQualityGates(join(PROJECT_PATH, 'frontend'), 'pre_push');

    expect(mockRunQualityGates).toHaveBeenCalledOnce();
    const [gatesArg] = mockRunQualityGates.mock.calls[0];
    expect(Object.keys(gatesArg)).toEqual(['fe-lint']);
    expect(results).toEqual(PASSING_GATE_RESULT);
  });

  it('matches gates by configured repo alias in polyrepo context', async () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: PROJECT_PATH,
          workspace: {
            repos: [
              { name: 'fe', path: 'frontend' },
              { name: 'api', path: 'backend' },
            ],
          },
          quality_gates: {
            'fe-lint': { command: 'pnpm lint', path: 'fe', required: true },
            'api-lint': { command: './mvnw checkstyle:check', path: 'api', required: true },
          },
        },
      },
    } as any);

    const results = await runProjectQualityGates(join(PROJECT_PATH, 'frontend'), 'pre_push');

    expect(mockRunQualityGates).toHaveBeenCalledOnce();
    const [gatesArg] = mockRunQualityGates.mock.calls[0];
    expect(Object.keys(gatesArg)).toEqual(['fe-lint']);
    expect(results).toEqual(PASSING_GATE_RESULT);
  });

  it('skips gates with non-matching path in polyrepo context', async () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: PROJECT_PATH,
          quality_gates: {
            'fe-lint': { command: 'pnpm lint', path: 'frontend', required: true },
          },
        },
      },
    } as any);

    // Merging the backend repo — fe-lint should be skipped
    const results = await runProjectQualityGates(join(PROJECT_PATH, 'backend'), 'pre_push');

    expect(mockRunQualityGates).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('skips gates with no path in polyrepo context', async () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: PROJECT_PATH,
          quality_gates: {
            'global-check': { command: 'make check', required: true },
          },
        },
      },
    } as any);

    // Gate has no path → not applicable to any specific repo
    const results = await runProjectQualityGates(join(PROJECT_PATH, 'frontend'), 'pre_push');

    expect(mockRunQualityGates).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});

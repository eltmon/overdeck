import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';

// Mock fs to prevent reading actual env files
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
  };
});

// Mock projects module
vi.mock('../../src/lib/projects.js', () => ({
  loadProjectsConfig: vi.fn(),
  getIssuePrefix: (config: any) => config?.issue_prefix,
}));

import { resolveTrackerTypeSync } from '../../src/lib/tracker-utils.js';
import { loadProjectsConfigSync } from '../../src/lib/projects.js';

const mockLoadProjectsConfig = vi.mocked(loadProjectsConfigSync);

describe('resolveTrackerType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure env file is not read
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('returns "github" for issues matching a project with github_repo', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        panopticon: {
          name: 'Panopticon',
          path: '/home/user/panopticon',
          github_repo: 'eltmon/panopticon-cli',
          issue_prefix: 'PAN',
        },
      },
    });

    expect(resolveTrackerTypeSync('PAN-123')).toBe('github');
  });

  it('returns "rally" for issues matching a rally-only project', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        acme: {
          name: 'Acme Project',
          path: '/home/user/acme',
          rally_project: '/project/822404704163',
        },
      },
    });

    expect(resolveTrackerTypeSync('ACME-42')).toBe('rally');
  });

  it('returns "linear" for issues matching a project with issue_prefix', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myapp: {
          name: 'My App',
          path: '/home/user/myapp',
          issue_prefix: 'MIN',
        },
      },
    });

    expect(resolveTrackerTypeSync('MIN-456')).toBe('linear');
  });

  it('returns "rally" for issues with issue_prefix when rally_project is configured', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        hybrid: {
          name: 'Hybrid Project',
          path: '/home/user/hybrid',
          issue_prefix: 'HYB',
          rally_project: '/project/999',
        },
      },
    });

    expect(resolveTrackerTypeSync('HYB-10')).toBe('rally');
  });

  it('returns "linear" as fallback for unknown prefixes', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        panopticon: {
          name: 'Panopticon',
          path: '/home/user/panopticon',
          github_repo: 'eltmon/panopticon-cli',
          issue_prefix: 'PAN',
        },
      },
    });

    expect(resolveTrackerTypeSync('UNKNOWN-99')).toBe('linear');
  });

  it('handles projects.yaml load failure gracefully', () => {
    mockLoadProjectsConfig.mockImplementation(() => {
      throw new Error('File not found');
    });

    expect(resolveTrackerTypeSync('ANYTHING-1')).toBe('linear');
  });
});

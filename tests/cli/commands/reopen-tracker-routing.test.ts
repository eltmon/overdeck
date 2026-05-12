/**
 * Tests for resolver parity between `pan reopen` and `pan start`.
 *
 * Verifies that `resolveTrackerType` returns the correct tracker type for both
 * GitHub (PAN-XXX) and Linear (MIN-XXX) issues, ensuring `pan reopen` routes
 * to the correct tracker just like `pan start` does.
 *
 * PAN-1104: pan reopen was misrouting GitHub issues to Linear because it used
 * Linear SDK directly instead of going through resolveTrackerType.
 */

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
vi.mock('../../../src/lib/projects.js', () => ({
  loadProjectsConfig: vi.fn(),
  getIssuePrefix: (config: any) => config?.issue_prefix,
}));

import { resolveTrackerType } from '../../../src/lib/tracker-utils.js';
import { loadProjectsConfig } from '../../../src/lib/projects.js';

const mockLoadProjectsConfig = vi.mocked(loadProjectsConfig);

describe('pan reopen tracker routing parity with pan start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  /**
   * PAN-1104 regression test: ensure GitHub issues (PAN-XXX) route to GitHub
   * and NOT to Linear when both trackers are configured.
   *
   * This is the core fix: `pan reopen pan-457` should update the GitHub issue
   * #457 in eltmon/panopticon-cli, not MIN-848 in Linear.
   */
  it('routes PAN-XXX issues to GitHub (not Linear) when project has github_repo', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        panopticon: {
          name: 'Panopticon',
          path: '/home/user/panopticon',
          github_repo: 'eltmon/panopticon-cli',
          issue_prefix: 'PAN',
        },
        myn: {
          name: 'Mind Your Now',
          path: '/home/user/myn',
          issue_prefix: 'MIN',
        },
      },
    });

    // PAN-457 should resolve to GitHub (same as pan start)
    expect(resolveTrackerType('PAN-457')).toBe('github');
    // MIN-848 should still resolve to Linear
    expect(resolveTrackerType('MIN-848')).toBe('linear');
  });

  /**
   * Verify the resolver is consistent for Linear-only projects.
   * MIN-XXX should always route to Linear when there's no github_repo.
   */
  it('routes MIN-XXX issues to Linear when no github_repo is configured', () => {
    mockLoadProjectsConfig.mockReturnValue({
      projects: {
        myn: {
          name: 'Mind Your Now',
          path: '/home/user/myn',
          issue_prefix: 'MIN',
        },
      },
    });

    expect(resolveTrackerType('MIN-123')).toBe('linear');
    expect(resolveTrackerType('MIN-848')).toBe('linear');
  });

  /**
   * Edge case: ensure unknown prefixes default to Linear (safe fallback).
   */
  it('defaults unknown prefixes to Linear as safe fallback', () => {
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

    expect(resolveTrackerType('UNKNOWN-99')).toBe('linear');
  });

  /**
   * Verify GitHub resolution via parseGitHubRepos (auto-derived from projects.yaml).
   * This ensures the auto-derive path also works correctly.
   */
  it('auto-derives GitHub repo from github_repo in projects.yaml', () => {
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

    // PAN prefix matches the github_repo project → github
    expect(resolveTrackerType('PAN-1')).toBe('github');
    expect(resolveTrackerType('PAN-999')).toBe('github');
  });
});

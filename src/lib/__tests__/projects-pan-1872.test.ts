/**
 * PAN-1872 regression test: findProjectByTeamSync must not crash when teamPrefix
 * is null or undefined. This defends against `Cannot read properties of undefined
 * (reading 'toUpperCase')` during pan start recovery from a sync-main conflict.
 */
import { describe, expect, it, vi } from 'vitest';

const projectMock = vi.hoisted(() => ({
  current: {
    name: 'Overdeck',
    path: '/repo',
    github_repo: 'eltmon/overdeck',
    issue_prefix: 'PAN',
  },
}));

vi.mock('../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projects.js')>();
  return {
    ...actual,
    loadProjectsConfigSync: () => ({ projects: { overdeck: projectMock.current } }),
  };
});

import { findProjectByTeamSync } from '../projects.js';

describe('findProjectByTeamSync PAN-1872 guards', () => {
  it('returns null when teamPrefix is undefined', () => {
    expect(findProjectByTeamSync(undefined as any)).toBeNull();
  });

  it('returns null when teamPrefix is null', () => {
    expect(findProjectByTeamSync(null as any)).toBeNull();
  });

  it('returns null when teamPrefix is an empty string', () => {
    expect(findProjectByTeamSync('')).toBeNull();
  });
});

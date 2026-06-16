/**
 * Tests for PAN-1908 infra-repo resolver.
 */

import { describe, it, expect } from 'vitest';
import { resolveInfraRepo, type ProjectConfig } from '../../../src/lib/projects.js';

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: 'Test',
    path: '/projects/test',
    ...overrides,
  };
}

describe('resolveInfraRepo', () => {
  it('defaults to project path and .pan when pan_records is absent', () => {
    const project = makeProject();
    expect(resolveInfraRepo(project)).toEqual({
      repoPath: '/projects/test',
      recordsPath: '.pan',
    });
  });

  it('defaults to project path when pan_records.repo is "."', () => {
    const project = makeProject({
      pan_records: { repo: '.', path: '.pan' },
    });
    expect(resolveInfraRepo(project)).toEqual({
      repoPath: '/projects/test',
      recordsPath: '.pan',
    });
  });

  it('uses a custom records path when provided', () => {
    const project = makeProject({
      pan_records: { path: 'infra/.pan' },
    });
    expect(resolveInfraRepo(project)).toEqual({
      repoPath: '/projects/test',
      recordsPath: 'infra/.pan',
    });
  });

  it('resolves a polyrepo infra repo by name', () => {
    const project = makeProject({
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'api', path: 'api' },
          { name: 'infra', path: 'infra-repo' },
          { name: 'fe', path: 'frontend' },
        ],
      },
      pan_records: { repo: 'infra', path: '.pan' },
    });
    expect(resolveInfraRepo(project)).toEqual({
      repoPath: '/projects/test/infra-repo',
      recordsPath: '.pan',
    });
  });

  it('throws when pan_records.repo is not found in workspace.repos', () => {
    const project = makeProject({
      workspace: {
        type: 'polyrepo',
        repos: [{ name: 'api', path: 'api' }],
      },
      pan_records: { repo: 'missing', path: '.pan' },
    });
    expect(() => resolveInfraRepo(project)).toThrow(
      'Project pan_records.repo "missing" not found in workspace.repos'
    );
  });
});

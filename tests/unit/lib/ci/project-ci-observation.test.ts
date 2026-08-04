import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../../../../src/lib/projects.js';
import type { WebhookPayload } from '../../../../src/lib/webhook-handlers.js';
import {
  observationFromCheckSuite,
  resolveProjectForRepo,
} from '../../../../src/lib/ci/project-ci-observation.js';

const projects: Array<{ key: string; config: ProjectConfig }> = [{
  key: 'overdeck',
  config: {
    name: 'Overdeck',
    path: '/tmp/overdeck',
    github_repo: 'eltmon/overdeck',
    workspace: { default_branch: 'main' },
  },
}];

function payload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    repository: { full_name: 'eltmon/overdeck' },
    check_suite: {
      id: 42,
      status: 'in_progress',
      conclusion: null,
      head_branch: 'main',
      head_sha: 'abc123',
      app: { slug: 'github-actions' },
      pull_requests: [],
    },
    ...overrides,
  };
}

describe('resolveProjectForRepo', () => {
  it('matches GitHub repositories case-insensitively and defaults the branch to main', () => {
    expect(resolveProjectForRepo('ELTMON/OVERDECK', [{
      ...projects[0]!,
      config: { ...projects[0]!.config, workspace: undefined },
    }])).toEqual({ projectKey: 'overdeck', repo: 'eltmon/overdeck', branch: 'main' });
  });

  it('returns null for an unregistered repository', () => {
    expect(resolveProjectForRepo('eltmon/unknown', projects)).toBeNull();
  });
});

describe('observationFromCheckSuite', () => {
  it.each([
    ['missing check suite', payload({ check_suite: undefined })],
    ['non-GitHub Actions app', payload({ check_suite: { ...payload().check_suite!, app: { slug: 'vercel' } } })],
    ['non-default branch', payload({ check_suite: { ...payload().check_suite!, head_branch: 'feature/pan-3537' } })],
    ['missing head SHA', payload({ check_suite: { ...payload().check_suite!, head_sha: undefined } })],
    ['missing suite id', payload({ check_suite: { ...payload().check_suite!, id: undefined } })],
    ['unregistered repository', payload({ repository: { full_name: 'eltmon/unknown' } })],
  ])('returns null for %s', (_name, webhookPayload) => {
    expect(observationFromCheckSuite(
      webhookPayload,
      '2026-08-04T08:00:00.000Z',
      projects,
      'abc123',
    )).toBeNull();
  });

  it('rejects a suite that is not for the authoritative branch head', () => {
    expect(observationFromCheckSuite(
      payload(),
      '2026-08-04T08:00:00.000Z',
      projects,
      'newer-sha',
    )).toBeNull();
  });

  it('uses the suite update time instead of webhook arrival time', () => {
    const webhookPayload = payload({
      check_suite: {
        ...payload().check_suite!,
        updated_at: '2026-08-04T07:55:00.000Z',
      },
    });

    expect(observationFromCheckSuite(
      webhookPayload,
      '2026-08-04T08:00:00.000Z',
      projects,
      'abc123',
    )?.observedAt).toBe('2026-08-04T07:55:00.000Z');
  });

  it('maps a default-branch GitHub Actions suite to an observation', () => {
    expect(observationFromCheckSuite(
      payload(),
      '2026-08-04T08:00:00.000Z',
      projects,
      'abc123',
    )).toEqual({
      projectKey: 'overdeck',
      repo: 'eltmon/overdeck',
      branch: 'main',
      headSha: 'abc123',
      suiteId: '42',
      status: 'in_progress',
      conclusion: null,
      observedAt: '2026-08-04T08:00:00.000Z',
      authoritativeHead: true,
    });
  });
});

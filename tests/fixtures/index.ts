/**
 * Test fixtures for Overdeck tests
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Config fixture
export const configFixture = readFileSync(join(__dirname, 'config.toml'), 'utf8');

// Issue fixture
export const issueFixture = JSON.parse(
  readFileSync(join(__dirname, 'issue.json'), 'utf8')
);

// Mock issue data generators
export function createMockLinearIssue(overrides: Partial<typeof issueFixture.linear> = {}) {
  return {
    ...issueFixture.linear,
    ...overrides,
  };
}

export function createMockGitHubIssue(overrides: Partial<typeof issueFixture.github> = {}) {
  return {
    ...issueFixture.github,
    ...overrides,
  };
}

export function createMockNormalizedIssue(overrides: Partial<typeof issueFixture.normalized> = {}) {
  return {
    ...issueFixture.normalized,
    ...overrides,
  };
}

// Mock API responses
export const mockLinearResponses = {
  issue: (id: string) => ({
    id: `issue-${id}`,
    identifier: id,
    title: `Issue ${id}`,
    description: 'Mock description',
    state: Promise.resolve({ name: 'Todo' }),
    priority: 2,
    url: `https://linear.app/test/issue/${id}`,
    labels: { nodes: [] },
    assignee: Promise.resolve(null),
  }),

  issues: (count: number = 5) => ({
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `issue-${i + 1}`,
      identifier: `TEST-${i + 1}`,
      title: `Issue ${i + 1}`,
      state: { name: i % 2 === 0 ? 'Todo' : 'In Progress' },
      priority: (i % 4) + 1,
    })),
  }),

  teams: () => ({
    nodes: [
      { id: 'team-1', key: 'TEST', name: 'Test Team' },
      { id: 'team-2', key: 'DEV', name: 'Dev Team' },
    ],
  }),
};

export const mockGitHubResponses = {
  issue: (number: number) => ({
    data: {
      id: number * 1000,
      number,
      title: `GitHub Issue ${number}`,
      body: 'Mock description',
      state: 'open',
      labels: [],
      assignee: null,
      html_url: `https://github.com/owner/repo/issues/${number}`,
    },
  }),

  issues: (count: number = 5) => ({
    data: Array.from({ length: count }, (_, i) => ({
      id: (i + 1) * 1000,
      number: i + 1,
      title: `GitHub Issue ${i + 1}`,
      state: i % 2 === 0 ? 'open' : 'closed',
      html_url: `https://github.com/owner/repo/issues/${i + 1}`,
    })),
  }),
};

// Environment fixtures
export function createMockEnv(overrides: Record<string, string> = {}) {
  return {
    LINEAR_API_KEY: 'lin_test_key_12345',
    GITHUB_TOKEN: 'ghp_test_token_67890',
    WORKSPACE_ROOT: '/tmp/test-workspaces',
    ...overrides,
  };
}

// Skill fixture
export const skillFixture = {
  name: 'test-skill',
  description: 'A test skill for fixtures',
  triggers: ['test trigger', 'another trigger'],
  'allowed-tools': ['Bash', 'Read', 'Write'],
  content: `---
name: test-skill
description: A test skill for fixtures
triggers:
  - test trigger
  - another trigger
allowed-tools:
  - Bash
  - Read
  - Write
---

# Test Skill

This is a test skill used in fixtures.

## Usage

Test usage instructions.
`,
};

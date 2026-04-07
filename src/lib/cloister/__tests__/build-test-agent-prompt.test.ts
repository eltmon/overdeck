/**
 * Tests for buildTestAgentPromptContent (PAN-467)
 *
 * Verifies the shared test-agent prompt builder produces correct output for
 * the common workspace configurations (single-suite, no tests, polyrepo).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTestAgentPromptContent } from '../specialists.js';

// buildTestAgentPromptContent dynamically imports '../projects.js' — mock it so
// tests don't require a real projects.yaml on disk.
vi.mock('../../projects.js', () => ({
  extractTeamPrefix: (id: string) => id.split('-')[0].toUpperCase(),
  findProjectByTeam: () => null,
}));

// resolveWorkspaceGitInfo is an internal helper — stub it out via the module.
vi.mock('../specialists.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../specialists.js')>();
  return {
    ...mod,
    // We re-export buildTestAgentPromptContent as-is; just mock the git helper
    // by intercepting the internal import. Since it's called inside the function
    // via a module-level import, we instead rely on the workspace path not
    // existing (resolveWorkspaceGitInfo gracefully falls back).
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildTestAgentPromptContent', () => {
  it('returns a non-empty prompt string', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
      branch: 'feature/pan-467',
      workspace: '/tmp/fake-workspace',
    });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes the issue ID in API curl commands', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
      branch: 'feature/pan-467',
      workspace: '/tmp/fake-workspace',
    });
    expect(prompt).toContain('PAN-467');
  });

  it('includes test status API endpoint instructions', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
    });
    expect(prompt).toContain('review-status');
    expect(prompt).toContain('testStatus');
  });

  it('instructs agent to redirect output to avoid context exhaustion', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
      workspace: '/tmp/fake-workspace',
    });
    expect(prompt).toContain('/tmp/test-feature.txt');
    expect(prompt).toContain('NEVER let full test output');
  });

  it('falls back to npm test when workspace has no project config', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
      workspace: '/tmp/nonexistent-workspace',
    });
    expect(prompt).toContain('npm test');
  });

  it('includes Step 1 / Step 2 / Step 3 structure', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-467',
    });
    expect(prompt).toContain('Step 1');
    expect(prompt).toContain('Step 2');
    expect(prompt).toContain('Step 3');
  });

  it('includes baseline comparison instructions', async () => {
    const prompt = await buildTestAgentPromptContent({
      issueId: 'PAN-999',
      workspace: '/tmp/fake',
    });
    expect(prompt).toContain('/tmp/test-main.txt');
    expect(prompt).toContain('Baseline');
  });
});

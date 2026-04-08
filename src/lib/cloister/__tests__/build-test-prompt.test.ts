import { describe, it, expect } from 'vitest';
import { buildTestAgentPromptContent } from '../specialists.js';

/**
 * Tests for buildTestAgentPromptContent — the shared test-agent prompt builder.
 *
 * These tests use an unknown issue prefix (TEST-*) so that findProjectByTeam returns
 * null, exercising the default (single-suite, non-polyrepo) code path without
 * requiring filesystem setup or project config mocking.
 */
describe('buildTestAgentPromptContent', () => {
  it('returns a non-empty prompt string', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-1' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the issueId in the API curl commands', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'MYISSUE-42' });
    expect(result).toContain('MYISSUE-42');
  });

  it('defaults to localhost:3011 API URL when no env vars set', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-2' });
    expect(result).toContain('http://localhost:3011');
  });

  it('uses DASHBOARD_URL env var when set', async () => {
    const orig = process.env.DASHBOARD_URL;
    process.env.DASHBOARD_URL = 'http://custom-host:9999';
    try {
      const result = await buildTestAgentPromptContent({ issueId: 'TEST-3' });
      expect(result).toContain('http://custom-host:9999');
    } finally {
      if (orig === undefined) delete process.env.DASHBOARD_URL;
      else process.env.DASHBOARD_URL = orig;
    }
  });

  it('uses default 300000ms timeout when no maven test configs', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-4' });
    expect(result).toContain('300000');
  });

  it('generates default workspace-root test commands when no configs found', async () => {
    const result = await buildTestAgentPromptContent({
      issueId: 'TEST-5',
      workspace: undefined,
      branch: 'feature/test-5',
    });
    // Default path: workspace 'unknown', generates `cd "unknown" && npm test`
    expect(result).toContain('npm test');
  });

  it('includes all required sections in the prompt', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-6' });
    expect(result).toContain('## Step 1: Run Feature Branch Tests');
    expect(result).toContain('## Step 2: Check Results');
    expect(result).toContain('## Step 3: Baseline Comparison');
    expect(result).toContain('## REQUIRED: Update Status via API');
  });

  it('instructs agent NOT to hand off to merge-agent', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-7' });
    expect(result).toContain('Do NOT hand off to merge-agent');
  });

  it('includes output redirection instructions', async () => {
    const result = await buildTestAgentPromptContent({ issueId: 'TEST-8' });
    expect(result).toContain('/tmp/test-feature.txt');
    expect(result).toContain('/tmp/test-main.txt');
  });
});

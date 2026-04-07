import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestAgentPromptContent } from '../specialists.js';

describe('buildTestAgentPromptContent', () => {
  let originalApiPort: string | undefined;
  let originalDashboardUrl: string | undefined;

  beforeEach(() => {
    originalApiPort = process.env.API_PORT;
    originalDashboardUrl = process.env.DASHBOARD_URL;
    delete process.env.API_PORT;
    delete process.env.DASHBOARD_URL;
  });

  afterEach(() => {
    if (originalApiPort === undefined) {
      delete process.env.API_PORT;
    } else {
      process.env.API_PORT = originalApiPort;
    }
    if (originalDashboardUrl === undefined) {
      delete process.env.DASHBOARD_URL;
    } else {
      process.env.DASHBOARD_URL = originalDashboardUrl;
    }
  });

  it('returns a non-empty string', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes the issueId in the API curl commands', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('PAN-999');
  });

  it('includes required sections', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('## Step 1: Run Feature Branch Tests');
    expect(prompt).toContain('## REQUIRED: Update Status via API');
    expect(prompt).toContain('testStatus');
  });

  it('defaults to localhost:3011 API URL when no env vars set', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('http://localhost:3011');
  });

  it('uses DASHBOARD_URL when set', async () => {
    process.env.DASHBOARD_URL = 'http://custom-host:9000';
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('http://custom-host:9000');
  });

  it('uses API_PORT when set', async () => {
    process.env.API_PORT = '4000';
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('localhost:4000');
  });

  it('uses fallback single test suite when no workspace or configs provided', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    // Without a workspace, falls back to single test suite at workspace root
    expect(prompt).toContain('npm test');
  });

  it('includes baseline comparison instructions', async () => {
    const prompt = await buildTestAgentPromptContent({ issueId: 'PAN-999' });
    expect(prompt).toContain('## Step 3: Baseline Comparison');
    expect(prompt).toContain('ZERO new test failures');
  });
});

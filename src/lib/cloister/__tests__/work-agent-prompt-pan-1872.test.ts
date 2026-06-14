/**
 * PAN-1872 regression test: buildWorkAgentPrompt must not crash when issueId
 * is missing or malformed. This defends against `Cannot read properties of
 * undefined (reading 'toUpperCase')` during pan start recovery from a
 * sync-main conflict.
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';

const renderPromptMock = vi.hoisted(() => vi.fn());

vi.mock('../prompts.js', () => ({
  renderPrompt: renderPromptMock,
}));

vi.mock('../config-yaml.js', () => ({
  isTldrEnabledSync: vi.fn(() => false),
}));

import { buildWorkAgentPrompt, type WorkAgentPromptContext } from '../work-agent-prompt.js';

describe('buildWorkAgentPrompt PAN-1872 guards', () => {
  it('does not crash when issueId is undefined', async () => {
    renderPromptMock.mockImplementation((opts: any) =>
      Effect.succeed(`ISSUE_ID=${opts.vars.ISSUE_ID}, LOWER=${opts.vars.ISSUE_ID_LOWER}, BRANCH=${opts.vars.BRANCH_NAME}`),
    );

    const ctx: any = {
      issueId: undefined,
      env: 'LOCAL',
      workspacePath: '/tmp/workspace',
      projectRoot: '/tmp/project',
      skipDynamicContext: true,
    };

    const prompt = await buildWorkAgentPrompt(ctx);
    expect(prompt).toContain('ISSUE_ID=,');
    expect(prompt).toContain('BRANCH=feature/');
  });

  it('normalizes a present issueId into lower/upper case', async () => {
    renderPromptMock.mockImplementation((opts: any) =>
      Effect.succeed(`ISSUE_ID=${opts.vars.ISSUE_ID}, LOWER=${opts.vars.ISSUE_ID_LOWER}, BRANCH=${opts.vars.BRANCH_NAME}`),
    );

    const ctx: WorkAgentPromptContext = {
      issueId: 'PAN-1872',
      env: 'LOCAL',
      workspacePath: '/tmp/workspace',
      projectRoot: '/tmp/project',
      skipDynamicContext: true,
    };

    const prompt = await buildWorkAgentPrompt(ctx);
    expect(prompt).toContain('ISSUE_ID=PAN-1872');
    expect(prompt).toContain('LOWER=pan-1872');
    expect(prompt).toContain('BRANCH=feature/pan-1872');
  });
});

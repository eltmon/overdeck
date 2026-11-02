/**
 * PAN-4734 (FR-15): the REMOTE block names the agent's workspace path for the
 * workspace, continue file, spec and draft, while the REMOTE_DONE sentinel
 * stays at /workspace/.pan/REMOTE_DONE.
 */
import { describe, expect, it } from 'vitest';

import { buildWorkAgentPrompt } from '../work-agent-prompt.js';

async function remotePrompt(workspacePath: string): Promise<string> {
  return buildWorkAgentPrompt({ issueId: 'PAN-1', env: 'REMOTE', workspacePath, skipDynamicContext: true });
}

describe('REMOTE work prompt workspace path', () => {
  it('names a linked agent\'s VM worktree and keeps the sentinel under /workspace', async () => {
    const text = await remotePrompt('/workspace/overdeck/workspaces/feature-pan-1');

    expect(text).toContain('Your workspace is at /workspace/overdeck/workspaces/feature-pan-1 ');
    expect(text).toContain('`/workspace/overdeck/workspaces/feature-pan-1/.overdeck/continue.json`');
    expect(text).toContain('`/workspace/overdeck/workspaces/feature-pan-1/.pan/specs/');
    expect(text).toContain('`/workspace/overdeck/workspaces/feature-pan-1/.pan/drafts/');
    expect(text).toContain('touch /workspace/.pan/REMOTE_DONE');
  });

  it('names /workspace for a legacy remote agent', async () => {
    const text = await remotePrompt('/workspace');

    expect(text).toContain('Your workspace is at /workspace ');
    expect(text).toContain('`/workspace/.overdeck/continue.json`');
    expect(text).toContain('touch /workspace/.pan/REMOTE_DONE');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encodeClaudeProjectDir } from '../../../../lib/paths.js';
import { buildAgentConversationResult } from '../agents.js';

describe('agent conversation resolver integration', () => {
  let root: string;
  let previousOverdeckHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-conversation-integration-'));
    previousOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the concrete indexed candidate produced by the real resolver on a miss', async () => {
    const agentId = 'agent-pan-3950-integration';
    const workspace = join(root, 'workspace');
    const sessionId = '3d035e47-54b9-4dab-b48d-7ea38c410ec9';
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId: 'PAN-3950',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    }));
    writeFileSync(join(agentDir, 'sessions.json'), `${JSON.stringify({
      sessionId,
      at: '2026-09-20T00:00:00.000Z',
      source: 'launcher',
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
    })}\n`);

    const result = await buildAgentConversationResult(agentId);

    expect(result).toEqual({
      status: 404,
      body: {
        error: `No transcript found for ${agentId}.`,
        checked: [join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspace), `${sessionId}.jsonl`)],
      },
    });
  });
});

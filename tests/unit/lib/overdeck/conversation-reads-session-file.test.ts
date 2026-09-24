import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSessionFile } from '../../../../src/lib/overdeck/conversation-reads.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let overdeckHome: string;

beforeEach(async () => {
  overdeckHome = await mkdtemp(join(tmpdir(), 'pan-conversation-reads-'));
  process.env.OVERDECK_HOME = overdeckHome;
});

afterEach(async () => {
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  await rm(overdeckHome, { recursive: true, force: true });
});

describe('resolveSessionFile', () => {
  it('resolves the ACP transcript used by OpenCode conversation-list enrichment', async () => {
    const tmuxSession = 'conv-opencode-transcript';
    const agentDir = join(overdeckHome, 'agents', tmuxSession);
    const transcript = join(agentDir, 'acp-session.jsonl');
    await mkdir(agentDir, { recursive: true });
    await writeFile(transcript, `${JSON.stringify({ role: 'assistant', content: 'working' })}\n`);

    const conversation = {
      harness: 'opencode',
      tmuxSession,
      cwd: '/tmp/opencode-workspace',
      claudeSessionId: null,
      status: 'active',
    } as LegacyConversation;

    await expect(resolveSessionFile(conversation)).resolves.toBe(transcript);
  });
});

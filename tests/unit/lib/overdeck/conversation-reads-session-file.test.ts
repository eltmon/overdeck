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

  // PAN-4562: the transcript-kind table decides whether a miss falls through to the Claude path.
  const conversationFor = (harness: string, tmuxSession: string) => ({
    harness,
    tmuxSession,
    cwd: '/tmp/session-file-workspace',
    claudeSessionId: '6f1c2d4e-0000-4000-8000-000000004562',
    status: 'active',
  } as LegacyConversation);

  it.each(['muse', 'prime-agent'] as const)('%s owns its answer: a missing session file returns null', async (harness) => {
    await expect(resolveSessionFile(conversationFor(harness, `conv-${harness}-missing`))).resolves.toBeNull();
  });

  it('codex with no rollout file falls through to the Claude session path', async () => {
    const resolved = await resolveSessionFile(conversationFor('codex', 'conv-codex-missing'));
    expect(resolved).toMatch(/6f1c2d4e-0000-4000-8000-000000004562\.jsonl$/);
  });
});

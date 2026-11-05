import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSessionFile } from '../../../../src/lib/overdeck/conversation-reads.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';
import { claudeProjectDir, sessionFilePath } from '../../../../src/lib/runtimes/storage/claude-code.js';

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
    name: tmuxSession,
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

// PAN-2652 W3: the current locator wins over the launcher pin; superseded /clear rows read their own locator.
describe('resolveSessionFile — current locator over launcher pin', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000002652';
  const B = 'bbbbbbbb-0000-4000-8000-000000002652';
  const C = 'cccccccc-0000-4000-8000-000000002652';
  const originalHome = process.env.HOME;
  const cwd = '/tmp/pan-2652-reads-workspace';

  beforeEach(() => {
    process.env.HOME = overdeckHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  async function writeLauncher(tmuxSession: string, pinned: string): Promise<void> {
    const dir = join(overdeckHome, 'conversations', tmuxSession);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'launcher.sh'), `#!/bin/bash\nexec claude --session-id ${pinned}\n`);
  }

  async function writeTranscripts(...ids: string[]): Promise<void> {
    await mkdir(claudeProjectDir(cwd), { recursive: true });
    for (const id of ids) await writeFile(sessionFilePath(cwd, id), '{}\n');
  }

  const human = (overrides: Partial<LegacyConversation>) => ({
    name: 'conv-2652',
    harness: 'claude-code',
    tmuxSession: 'conv-2652',
    cwd,
    claudeSessionId: B,
    clearedToConvId: null,
    status: 'active',
    ...overrides,
  } as LegacyConversation);

  it('ac1: a human conversation pinned to a resolves its current locator b', async () => {
    await writeLauncher('conv-2652', A);
    await writeTranscripts(A, B);
    await expect(resolveSessionFile(human({ claudeSessionId: B }))).resolves.toBe(sessionFilePath(cwd, B));
  });

  it('ac2: a /clear parent and its chain head sharing one launcher resolve distinct files (#2672)', async () => {
    await writeLauncher('conv-2652', A);
    await writeTranscripts(A, C);
    const parent = human({ name: 'conv-2652', claudeSessionId: A, clearedToConvId: 2 });
    const head = human({ name: 'conv-2652-2', claudeSessionId: C });
    await expect(resolveSessionFile(parent)).resolves.toBe(sessionFilePath(cwd, A));
    await expect(resolveSessionFile(head)).resolves.toBe(sessionFilePath(cwd, C));
  });
});

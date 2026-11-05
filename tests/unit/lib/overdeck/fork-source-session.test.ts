/** PAN-2652 W4: the fork source is the conversation's current locator, not the launcher pin. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveForkSourceSessionFile } from '../../../../src/lib/overdeck/fork-source-session.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';
import { claudeProjectDir, sessionFilePath } from '../../../../src/lib/runtimes/storage/claude-code.js';

const A = 'aaaaaaaa-0000-4000-8000-000000002652';
const B = 'bbbbbbbb-0000-4000-8000-000000002652';
const cwd = '/tmp/pan-2652-fork-source-workspace';

const originalHome = process.env.HOME;
const originalOverdeckHome = process.env.OVERDECK_HOME;
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2652-fork-source-'));
  process.env.HOME = home;
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  await rm(home, { recursive: true, force: true });
});

describe('resolveForkSourceSessionFile (PAN-2652 W4)', () => {
  it('ac1: a human conversation pinned to a with current locator b forks from b.jsonl', async () => {
    const launcherDir = join(home, 'conversations', 'conv-2652');
    await mkdir(launcherDir, { recursive: true });
    await writeFile(join(launcherDir, 'launcher.sh'), `#!/bin/bash\nexec claude --session-id ${A}\n`);
    await mkdir(claudeProjectDir(cwd), { recursive: true });
    await writeFile(sessionFilePath(cwd, A), '{}\n');
    await writeFile(sessionFilePath(cwd, B), '{}\n');

    const conv = {
      name: 'conv-2652',
      harness: 'claude-code',
      tmuxSession: 'conv-2652',
      cwd,
      claudeSessionId: B,
      clearedToConvId: null,
      status: 'active',
    } as LegacyConversation;

    await expect(resolveForkSourceSessionFile(conv)).resolves.toBe(sessionFilePath(cwd, B));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { sessionFilePath } from '../../paths.js';
import { resolveConversationTranscript } from '../transcript-path.js';

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'pan-transcript-path-'));
  vi.stubEnv('HOME', homeDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(homeDir, { recursive: true, force: true });
});

async function writeJsonl(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ type: 'system' }) + '\n', 'utf-8');
}

describe('resolveConversationTranscript', () => {
  it('returns ok with the derived sessionFilePath when it exists', async () => {
    const cwd = '/tmp/pan-workspace-derived';
    const sessionId = 'derived-session';
    const expectedPath = sessionFilePath(cwd, sessionId);
    await writeJsonl(expectedPath);

    expect(resolveConversationTranscript(cwd, sessionId)).toEqual({
      path: expectedPath,
      status: 'ok',
    });
  });

  it('returns ok with the first one-level ~/.claude/projects glob match when the derived path is absent', async () => {
    const sessionId = 'glob-session';
    const firstMatch = join(homeDir, '.claude', 'projects', 'aaa-drifted-cwd', `${sessionId}.jsonl`);
    const secondMatch = join(homeDir, '.claude', 'projects', 'zzz-drifted-cwd', `${sessionId}.jsonl`);
    await writeJsonl(secondMatch);
    await writeJsonl(firstMatch);

    expect(resolveConversationTranscript('/tmp/original-cwd', sessionId)).toEqual({
      path: firstMatch,
      status: 'ok',
    });
  });

  it('returns expired with the derived path when no transcript exists', () => {
    const cwd = '/tmp/pan-workspace-expired';
    const sessionId = 'expired-session';

    expect(resolveConversationTranscript(cwd, sessionId)).toEqual({
      path: sessionFilePath(cwd, sessionId),
      status: 'expired',
    });
  });

  it('returns unknown with a null path when the claude session id is missing', () => {
    expect(resolveConversationTranscript('/tmp/pan-workspace-unknown', null)).toEqual({
      path: null,
      status: 'unknown',
    });
    expect(resolveConversationTranscript('/tmp/pan-workspace-unknown', '')).toEqual({
      path: null,
      status: 'unknown',
    });
  });
});

/** PAN-2652 W7/W8: the lifecycle poll adopts lineage-verified Claude Code forks. */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adoptForkedClaudeSessions,
  defaultForkAdoptionDeps,
  resetForkAdoptionCachesForTest,
  type ForkAdoptionDeps,
} from '../../../../src/lib/overdeck/conversation-fork-adoption.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';

const A = 'aaaaaaaa-0000-4000-8000-000000002652';
const B = 'bbbbbbbb-0000-4000-8000-000000002652';
const C = 'cccccccc-0000-4000-8000-000000002652';

let root: string;
let overdeckHome: string;
let projectDir: string;
let otherProjectDir: string;
let adopted: Array<[string, string]>;
let logs: string[];
let owned: Set<string>;
let opened: string[];
let dirReads: string[];

function deps(): ForkAdoptionDeps {
  return {
    overdeckHome: () => overdeckHome,
    claudeProjectDir: () => projectDir,
    isLocatorOwned: (id) => owned.has(id),
    adopt: (name, id) => { adopted.push([name, id]); },
    log: (message) => { logs.push(message); },
    openLines: (path) => {
      opened.push(path);
      return defaultForkAdoptionDeps.openLines(path);
    },
    readDir: (path) => {
      dirReads.push(path);
      return defaultForkAdoptionDeps.readDir(path);
    },
  };
}

function conv(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    name: 'conv-a',
    tmuxSession: 'conv-a',
    cwd: '/work/a',
    claudeSessionId: A,
    clearedToConvId: null,
    status: 'active',
    harness: 'claude-code',
    ...overrides,
  } as LegacyConversation;
}

const entry = (uuid: string, text = uuid) =>
  JSON.stringify({ type: 'user', uuid, parentUuid: null, message: { role: 'user', content: text } });
const meta = (type: string) => JSON.stringify({ type, sessionId: 'x' });
const forkHead = () => ['ai-title', 'agent-name', 'mode', 'permission-mode', 'file-history-snapshot'].map(meta);

async function writeJsonl(dir: string, id: string, lines: string[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  await writeFile(path, `${lines.join('\n')}\n`);
  return path;
}

async function writeIndex(tmuxSession: string, ids: string[]): Promise<void> {
  const dir = join(overdeckHome, 'agents', tmuxSession);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'sessions.json'),
    ids.map((sessionId, i) => JSON.stringify({ sessionId, at: new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString(), source: 'heartbeat-hook' })).join('\n') + '\n',
  );
}

const currentLines = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => entry(u));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pan-2652-fork-adoption-'));
  overdeckHome = join(root, 'overdeck');
  projectDir = join(root, 'projects', '-work-a');
  otherProjectDir = join(root, 'projects', '-work-other');
  adopted = [];
  logs = [];
  owned = new Set();
  opened = [];
  dirReads = [];
  resetForkAdoptionCachesForTest();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('adoptForkedClaudeSessions — session index (PAN-2652 W7)', () => {
  it('ac1: adopts a same-dir fork recorded after the current session that shares copied uuids', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('u1'), entry('u2'), entry('u3'), entry('u9', 'after fork')]);
    await writeIndex('conv-a', [A, B]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([['conv-a', B]]);
    expect(logs).toEqual([`[conversation-lifecycle] adopted forked Claude session ${B} for conv-a (was ${A})`]);
  });

  it('ac2: never adopts a post-/clear session recorded in the same index', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [
      JSON.stringify({ type: 'user', uuid: 'c1', timestamp: '2026-11-05T00:00:00.000Z', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
      entry('c2'),
    ]);
    await writeIndex('conv-a', [A, B]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([]);
  });

  it('ac2: never adopts a session whose file lives in another project dir', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(otherProjectDir, B, [...forkHead(), entry('u1'), entry('u2')]);
    await writeIndex('conv-a', [A, B]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([]);
  });

  it('ac3: a candidate without shared uuids is not adopted and its verdict is cached', async () => {
    const currentPath = await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('n1'), entry('n2')]);
    await writeIndex('conv-a', [A, B]);

    await adoptForkedClaudeSessions([conv()], deps());
    expect(adopted).toEqual([]);
    expect(opened.filter((p) => p === currentPath)).toHaveLength(1);

    await adoptForkedClaudeSessions([conv()], deps());
    expect(adopted).toEqual([]);
    expect(opened.filter((p) => p === currentPath)).toHaveLength(1);
  });

  it('does not cache a candidate that has no uuid-bearing entry yet', async () => {
    await writeJsonl(projectDir, A, currentLines);
    const forkPath = await writeJsonl(projectDir, B, forkHead());
    await writeIndex('conv-a', [A, B]);

    await adoptForkedClaudeSessions([conv()], deps());
    expect(adopted).toEqual([]);

    await writeFile(forkPath, `${[...forkHead(), entry('u1')].join('\n')}\n`);
    await adoptForkedClaudeSessions([conv()], deps());
    expect(adopted).toEqual([['conv-a', B]]);
  });

  it('ac4: skips superseded rows and agent-named rows', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('u1')]);
    await writeIndex('conv-a', [A, B]);
    await writeIndex('agent-pan-1', [A, B]);

    await adoptForkedClaudeSessions([
      conv({ clearedToConvId: 9 }),
      conv({ name: 'agent-pan-1', tmuxSession: 'agent-pan-1' }),
    ], deps());

    expect(adopted).toEqual([]);
  });

  it('ac4: skips a candidate already owned by another conversation', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('u1')]);
    await writeIndex('conv-a', [A, B]);
    owned.add(B);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([]);
  });

  it('ignores sessions recorded before the current session and adopts the newest fork', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('u1')]);
    await writeJsonl(projectDir, C, [...forkHead(), entry('u2')]);
    await writeIndex('conv-a', [B, A, C]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([['conv-a', C]]);
  });

  it('a failure for one conversation does not stop the others', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), entry('u1')]);
    await writeIndex('conv-a', [A, B]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = { ...deps(), isLocatorOwned: (id: string) => { if (id === B && adopted.length === 0 && warn.mock.calls.length === 0) throw new Error('db down'); return false; } };

    await adoptForkedClaudeSessions([conv(), conv({ name: 'conv-a2' })], failing);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(adopted).toEqual([['conv-a2', B]]);
    warn.mockRestore();
  });
});

describe('adoptForkedClaudeSessions — backgrounding marker (PAN-2652 W8)', () => {
  const MARKER = 'fdff6afa-e108-4a1e-8106-34756795aadf';
  const marker = JSON.stringify({
    type: 'system',
    subtype: 'informational',
    content: 'Backgrounding after the current tool finishes…',
    uuid: MARKER,
    sessionId: A,
  });
  /** The marker 5 entries before the end, as in the real fork pair. */
  const markedCurrent = [...currentLines, marker, ...['u6', 'u7', 'u8', 'u9', 'u10'].map((u) => entry(u))];

  async function writeCurrent(): Promise<string> {
    const path = await writeJsonl(projectDir, A, markedCurrent);
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    return path;
  }

  it('ac1: adopts a newer project-dir file that copied the marker entry, with no session-index entry', async () => {
    await writeCurrent();
    await writeJsonl(projectDir, B, [...forkHead(), entry('u4'), marker, entry('f1', 'after fork')]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([['conv-a', B]]);
    expect(logs).toEqual([`[conversation-lifecycle] adopted forked Claude session ${B} for conv-a (was ${A})`]);
  });

  it('ac2: does not adopt a newer file without the marker uuid', async () => {
    await writeCurrent();
    await writeJsonl(projectDir, B, [...forkHead(), entry('x1'), entry('x2')]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([]);
  });

  it('ac2: ignores a subagent transcript under <id>/subagents/ that contains the marker uuid', async () => {
    await writeCurrent();
    await writeJsonl(join(projectDir, C, 'subagents'), 'agent-1', [entry('s1'), marker]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([]);
  });

  it('ac3: does not rescan the project dir while its mtime is unchanged', async () => {
    await writeCurrent();
    await writeJsonl(projectDir, B, [...forkHead(), entry('x1')]);

    await adoptForkedClaudeSessions([conv()], deps());
    expect(dirReads).toHaveLength(1);

    await adoptForkedClaudeSessions([conv()], deps());
    expect(dirReads).toHaveLength(1);
    expect(adopted).toEqual([]);
  });

  it('does not scan when the marker is not in the current file', async () => {
    await writeJsonl(projectDir, A, currentLines);
    await writeJsonl(projectDir, B, [...forkHead(), marker]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(dirReads).toEqual([]);
    expect(adopted).toEqual([]);
  });

  it('finds the marker across 64 KiB chunk boundaries', async () => {
    const bulky = (u: string) => entry(u, 'x'.repeat(40_000));
    const path = await writeJsonl(projectDir, A, [...currentLines, marker, bulky('b1'), bulky('b2'), bulky('b3'), bulky('b4')]);
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    await writeJsonl(projectDir, B, [...forkHead(), marker]);

    await adoptForkedClaudeSessions([conv()], deps());

    expect(adopted).toEqual([['conv-a', B]]);
  });
});

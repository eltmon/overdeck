/**
 * PAN-5290 WI-3: the working-tree lines one conversation changed in one file
 * (FR-5, C-D2), on real temporary git repositories with injected parse
 * results, plus the per-(conversation, file) cache (C-D2b).
 *
 * The file gets its own Overdeck home (set before any module loads), and git
 * runs isolated from the session running the tests: the git-guard PATH
 * segments are dropped and the agent/conversation ids deleted, so commits
 * carry only the trailers the tests write.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const isolated = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const saved = {
    OVERDECK_HOME: process.env.OVERDECK_HOME,
    PATH: process.env.PATH,
    OVERDECK_AGENT_ID: process.env.OVERDECK_AGENT_ID,
    OVERDECK_CONVERSATION: process.env.OVERDECK_CONVERSATION,
  };
  const overdeckHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-5290-lines-home-'));
  process.env.OVERDECK_HOME = overdeckHome;
  process.env.PATH = (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':');
  delete process.env.OVERDECK_AGENT_ID;
  delete process.env.OVERDECK_CONVERSATION;
  return { saved, overdeckHome };
});

import {
  getConversationChangedLines,
  resetConversationChangedLinesCacheForTests,
} from '../../../../src/lib/overdeck/conversation-change-lines.js';
import {
  resetConversationChangesCachesForTests,
  type ConversationChangesDependencies,
} from '../../../../src/lib/overdeck/conversation-changes.js';
import type { ConversationDiffParseResult } from '../../../../src/lib/overdeck/conversation-diffs.js';
import { createConversation } from '../../../../src/lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  OVERDECK_PAN_GIT_OP: '1',
  GIT_AUTHOR_NAME: 'lines', GIT_AUTHOR_EMAIL: 'lines@example.test',
  GIT_COMMITTER_NAME: 'lines', GIT_COMMITTER_EMAIL: 'lines@example.test',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'false',
};

const AT = '2020-01-01T11:05:00Z';

let root: string;
let counter = 0;

interface Setup {
  name: string;
  session: string;
  repo: string;
  setParsed(parsed: ConversationDiffParseResult): void;
  deps: ConversationChangesDependencies;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(repo: string, file: string, content: string, trailer?: string): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '--quiet', '-m', `change ${file}`, ...(trailer ? ['--trailer', trailer] : [])]);
}

function parse(workLog: WorkLogEntry[] = []): ConversationDiffParseResult {
  return {
    messages: [
      { role: 'user', id: 'u1', createdAt: '2020-01-01T11:00:00Z' },
      { role: 'assistant', id: 'a1', createdAt: '2020-01-01T11:10:00Z' },
    ],
    workLog,
    fileEditsByAssistantId: new Map(),
  };
}

function edit(filePath: string, oldString: string, newString: string): WorkLogEntry {
  return { id: `e${counter}`, createdAt: AT, label: 'Edit', toolTitle: 'Edit', tone: 'tool', toolInput: { file_path: filePath, old_string: oldString, new_string: newString } };
}

/** A fresh repository with a registered conversation whose transcript parse the test sets. */
function setup(): Setup {
  counter += 1;
  const repo = join(root, `repo-${counter}`);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet', '-b', 'main']);
  const name = `lines-${counter}`;
  const session = `conv-lines-${counter}`;
  createConversation({ name, tmuxSession: session, cwd: repo });
  const transcript = join(root, `${name}.jsonl`);
  writeFileSync(transcript, '{}\n');
  let parsed = parse();
  return {
    name,
    session,
    repo,
    setParsed: (next) => {
      parsed = next;
    },
    deps: {
      resolveSessionFile: async () => transcript,
      getCachedMessages: async () => parsed,
      peekCachedMessages: () => null,
      listConversations: () => [],
      now: Date.now,
    },
  };
}

async function lines(s: Setup, file: string, opts = {}): Promise<number[]> {
  const result = await getConversationChangedLines(s.name, file, s.deps, opts);
  expect(result.status).toBe(200);
  return (result.body as { lines: number[] }).lines;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-5290-lines-'));
});

afterAll(() => {
  closeOverdeckDatabase();
  for (const [key, value] of Object.entries(isolated.saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(isolated.overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  resetConversationChangesCachesForTests();
  resetConversationChangedLinesCacheForTests();
});

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (rows: string[]): string => `${rows.join('\n')}\n`;

describe('getConversationChangedLines', () => {
  it("marks the trailer commit's lines in working-tree numbering and not an unrelated commit's", async () => {
    const s = setup();
    commit(s.repo, 'src/app.ts', text(TEN));
    const mine = [...TEN];
    mine[2] = 'conversation three';
    mine[3] = 'conversation four';
    commit(s.repo, 'src/app.ts', text(mine), `Overdeck-Conversation: ${s.session}`);
    const later = [...mine];
    later[7] = 'someone else eight';
    later.splice(0, 0, 'inserted first');
    commit(s.repo, 'src/app.ts', text(later));

    expect(await lines(s, 'src/app.ts')).toEqual([4, 5]);
  });

  it("marks uncommitted lines this conversation wrote and not another session's lines in the same file", async () => {
    const s = setup();
    commit(s.repo, 'docs/shared.md', 'base\n');
    const shared = join(s.repo, 'docs/shared.md');
    writeFileSync(shared, 'base\nmine one\nmine two\nmine three\nmine four\ntheirs one\ntheirs two\n');
    s.setParsed(parse([edit(shared, 'base\n', 'base\nmine one\nmine two\nmine three\nmine four\n')]));

    expect(await lines(s, 'docs/shared.md')).toEqual([2, 3, 4, 5]);
  });

  it("marks every uncommitted line when attribution is 'file'", async () => {
    const s = setup();
    commit(s.repo, 'pi.txt', 'pi\nkept\n');
    writeFileSync(join(s.repo, 'pi.txt'), 'pi\nedited\n\nkept\nmore\n');
    s.setParsed(parse([
      { id: 'p1', createdAt: AT, label: 'edit', toolTitle: 'edit', tone: 'tool', toolInput: { path: 'pi.txt', oldText: 'pi', newText: 'pi\nedited' } },
    ]));

    expect(await lines(s, 'pi.txt')).toEqual([2, 3, 5]);
  });

  it('marks the non-empty lines of an untracked file the conversation wrote', async () => {
    const s = setup();
    commit(s.repo, 'README.md', 'readme\n');
    const created = join(s.repo, 'notes/new.md');
    mkdirSync(join(s.repo, 'notes'), { recursive: true });
    writeFileSync(created, 'one\n\nthree\n');
    s.setParsed(parse([
      { id: 'w1', createdAt: AT, label: 'Write', toolTitle: 'Write', tone: 'tool', toolInput: { file_path: created, content: 'one\n\nthree\n' } },
    ]));

    expect(await lines(s, 'notes/new.md')).toEqual([1, 3]);
  });

  it('returns no lines for a file the conversation did not change', async () => {
    const s = setup();
    commit(s.repo, 'a.txt', 'a\n');
    commit(s.repo, 'b.txt', 'b\n', `Overdeck-Conversation: ${s.session}`);

    expect(await lines(s, 'a.txt')).toEqual([]);
  });

  it('answers 400 for an invalid file and 404 for an unknown conversation', async () => {
    const s = setup();
    for (const file of ['', '../x', 'docs/../../x', '/etc/passwd', 'a\0b']) {
      expect(await getConversationChangedLines(s.name, file, s.deps)).toEqual({ status: 400, body: { error: 'Invalid file' } });
    }
    expect(await getConversationChangedLines('nobody-here', 'a.txt', s.deps)).toEqual({
      status: 404,
      body: { error: 'Conversation not found' },
    });
  });

  it('serves an unchanged second call from the cache and blames again after the file changes', async () => {
    const s = setup();
    commit(s.repo, 'docs/shared.md', 'base\n');
    const shared = join(s.repo, 'docs/shared.md');
    writeFileSync(shared, 'base\nmine one\n');
    s.setParsed(parse([edit(shared, 'base\n', 'base\nmine one\nmine two\n')]));
    const blame = vi.fn(async (repo: string, file: string) => git(repo, ['blame', '--porcelain', '--', file]) + '\n');

    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2]);
    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2]);
    expect(blame).toHaveBeenCalledTimes(1);

    appendFileSync(shared, 'mine two\n');
    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2, 3]);
    expect(blame).toHaveBeenCalledTimes(2);
  });

  it('does not cache an answer whose blame failed, so the next call retries it', async () => {
    const s = setup();
    commit(s.repo, 'docs/shared.md', 'base\n');
    const shared = join(s.repo, 'docs/shared.md');
    writeFileSync(shared, 'base\nmine one\n');
    s.setParsed(parse([edit(shared, 'base\n', 'base\nmine one\n')]));
    const blame = vi
      .fn(async (repo: string, file: string) => git(repo, ['blame', '--porcelain', '--', file]) + '\n')
      .mockRejectedValueOnce(new Error('index.lock exists'));

    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([]);
    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2]);
    expect(blame).toHaveBeenCalledTimes(2);
  });

  it('does not cache an answer when the file changed while it was computed', async () => {
    const s = setup();
    commit(s.repo, 'docs/shared.md', 'base\n');
    const shared = join(s.repo, 'docs/shared.md');
    writeFileSync(shared, 'base\nmine one\n');
    s.setParsed(parse([edit(shared, 'base\n', 'base\nmine one\nmine two\n')]));
    let first = true;
    const blame = vi.fn(async (repo: string, file: string) => {
      const out = git(repo, ['blame', '--porcelain', '--', file]) + '\n';
      if (first) {
        first = false;
        appendFileSync(shared, 'mine two\n');
      }
      return out;
    });

    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2]);
    expect(await lines(s, 'docs/shared.md', { blame })).toEqual([2, 3]);
    expect(blame).toHaveBeenCalledTimes(2);
  });
});

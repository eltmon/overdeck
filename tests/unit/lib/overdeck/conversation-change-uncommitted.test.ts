/**
 * PAN-5288 WI-3: the uncommitted files one conversation edited, with line
 * attribution decided from the edit records and other conversations named
 * only from cached parses.
 *
 * Fixture git calls run isolated from the session running the tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listUncommittedFiles, writtenLinesOf } from '../../../../src/lib/overdeck/conversation-change-uncommitted.js';
import type { ConversationDiffParseResult } from '../../../../src/lib/overdeck/conversation-diffs.js';

const fixtureEnv: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':'),
    OVERDECK_PAN_GIT_OP: '1',
    GIT_AUTHOR_NAME: 'changes', GIT_AUTHOR_EMAIL: 'changes@example.test',
    GIT_COMMITTER_NAME: 'changes', GIT_COMMITTER_EMAIL: 'changes@example.test',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'false',
  };
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_CONVERSATION;
  return env;
})();

let root: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(file: string, content: string): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(['add', file]);
  git(['commit', '--quiet', '-m', `add ${file}`]);
}

const AT = '2026-11-14T11:05:00Z';

function edit(id: string, filePath: string, oldString: string, newString: string): WorkLogEntry {
  return {
    id, createdAt: AT, label: 'Edit', toolTitle: 'Edit', tone: 'tool',
    toolInput: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}

function parse(workLog: WorkLogEntry[], edits: Array<[string, string]> = []): ConversationDiffParseResult {
  const fileEditsByAssistantId = new Map<string, Array<{ filePath: string }>>();
  for (const [assistantId, filePath] of edits) {
    fileEditsByAssistantId.set(assistantId, [...(fileEditsByAssistantId.get(assistantId) ?? []), { filePath }]);
  }
  return {
    messages: [
      { role: 'user', id: 'u1', createdAt: '2026-11-14T11:00:00Z' },
      { role: 'assistant', id: 'a1', createdAt: '2026-11-14T11:10:00Z' },
    ],
    workLog,
    fileEditsByAssistantId,
  };
}

const noOthers = async () => [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-5288-uncommitted-'));
  repo = join(root, 'repo');
  git(['init', '--quiet', '-b', 'main', repo], root);
  commitFile('docs/shared.md', 'base\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listUncommittedFiles', () => {
  it('attributes lines on a shared file and names only the conversation whose edit text matches the other lines', async () => {
    const shared = join(repo, 'docs/shared.md');
    writeFileSync(shared, 'base\nmine one\nmine two\nmine three\nmine four\ntheirs one\ntheirs two\n');
    const mine = parse([edit('e1', shared, 'base\n', 'base\nmine one\nmine two\nmine three\nmine four\n')], [['a1', shared]]);
    const matching = parse([edit('o1', shared, 'mine four\n', 'mine four\ntheirs one\ntheirs two\n')]);
    const unrelated = parse([edit('o2', shared, 'base\n', 'base\nsomething else\n')]);

    const files = await listUncommittedFiles({
      repoRoot: repo,
      cwd: repo,
      parsed: mine,
      others: async () => [
        { name: 'other-match', title: 'Matching', parsed: matching },
        { name: 'other-miss', title: 'Missing', parsed: unrelated },
      ],
    });

    expect(files).toEqual([{
      path: 'docs/shared.md',
      status: 'M',
      additions: 6,
      deletions: 0,
      attribution: 'lines',
      turnIds: ['a1'],
      otherLines: 2,
      otherConversations: [{ name: 'other-match', title: 'Matching' }],
    }]);
  });

  it('lists a Pi-shaped edit by file only, and skips a file changed only by a shell command', async () => {
    commitFile('pi.txt', 'pi\n');
    commitFile('shell.txt', 'shell\n');
    writeFileSync(join(repo, 'pi.txt'), 'pi\nedited\n');
    writeFileSync(join(repo, 'shell.txt'), 'shell\nedited\n');
    const parsed = parse([
      { id: 'p1', createdAt: AT, label: 'edit', toolTitle: 'edit', tone: 'tool', toolInput: { path: 'pi.txt', oldText: 'pi', newText: 'pi\nedited' } },
      { id: 'b1', createdAt: AT, label: 'Bash', toolTitle: 'Bash', tone: 'tool', toolInput: { command: "echo edited >> shell.txt" } },
    ]);

    const files = await listUncommittedFiles({ repoRoot: repo, cwd: repo, parsed, others: noOthers });

    expect(files).toEqual([{
      path: 'pi.txt', status: 'M', additions: 1, deletions: 0, attribution: 'file', turnIds: ['a1'],
    }]);
  });

  it('reports an untracked Write as added with its line count, and skips a committed-clean edited file', async () => {
    const created = join(repo, 'notes/new.md');
    mkdirSync(join(repo, 'notes'), { recursive: true });
    writeFileSync(created, 'one\ntwo\nthree\n');
    const parsed = parse(
      [
        { id: 'w1', createdAt: AT, label: 'Write', toolTitle: 'Write', tone: 'tool', toolInput: { file_path: created, content: 'one\ntwo\nthree\n' } },
        edit('e1', join(repo, 'docs/shared.md'), 'base', 'base'),
      ],
      [['a1', created], ['a1', join(repo, 'docs/shared.md')]],
    );

    const files = await listUncommittedFiles({ repoRoot: repo, cwd: repo, parsed, others: noOthers });

    expect(files).toEqual([{
      path: 'notes/new.md', status: 'A', additions: 3, deletions: 0, attribution: 'lines', turnIds: ['a1'], otherLines: 0,
    }]);
  });
});

describe('writtenLinesOf', () => {
  it('reads Edit, MultiEdit, Write and NotebookEdit inputs', () => {
    expect([...writtenLinesOf({ file_path: 'f', old_string: 'keep\nold', new_string: 'keep\nnew' })]).toEqual(['new']);
    expect([...writtenLinesOf({ file_path: 'f', edits: [{ old_string: '', new_string: 'x' }, { new_string: ' y ' }] })]).toEqual(['x', 'y']);
    expect([...writtenLinesOf({ file_path: 'f', content: 'a\n\nb\n' })]).toEqual(['a', 'b']);
    expect([...writtenLinesOf({ file_path: 'f', new_source: 'print(1)' })]).toEqual(['print(1)']);
  });
});

describe('peekCachedMessages', () => {
  it('returns null before getCachedMessages parsed a transcript and that parse afterwards', async () => {
    const previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    try {
      const transcript = join(root, 'session.jsonl');
      writeFileSync(transcript, `${JSON.stringify({
        type: 'user', uuid: 'u1', timestamp: '2026-11-14T11:00:00Z', message: { role: 'user', content: 'hello' },
      })}\n`);
      const { getCachedMessages, peekCachedMessages } = await import('../../../../src/lib/overdeck/conversation-reads.js');

      expect(peekCachedMessages(transcript)).toBeNull();
      const parsed = await getCachedMessages(transcript, false);
      expect(peekCachedMessages(transcript)).toBe(parsed);
    } finally {
      if (previousHome === undefined) delete process.env.OVERDECK_HOME;
      else process.env.OVERDECK_HOME = previousHome;
    }
  });
});

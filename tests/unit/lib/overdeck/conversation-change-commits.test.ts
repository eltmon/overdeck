/**
 * PAN-5288 WI-2: the commits one conversation made — exact trailer join on
 * the session name, the `git commit` tool-output fallback with its
 * reachability rule, pushed state, and the turn mapping.
 *
 * Fixture git calls run isolated from the session running the tests: the
 * git-guard PATH segments are dropped, the agent/conversation ids deleted, the
 * shim bypass is on, and identities and dates are fixed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listConversationCommits,
  listLocalShas,
  toolOutputCommitCandidates,
  turnIdAt,
} from '../../../../src/lib/overdeck/conversation-change-commits.js';
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

const SINCE = '2026-01-01T00:00:00Z';
let root: string;
let repo: string;
let clock = 0;

function git(args: string[], cwd = repo): string {
  const date = `2026-11-14T10:${String(clock++).padStart(2, '0')}:00Z`;
  return execFileSync('git', args, {
    cwd,
    env: { ...fixtureEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** `git commit` and its real stdout (the `[main abc1234] subject` line a shell tool result carries). */
function commitFile(file: string, content: string, message: string, extra: string[] = []): { output: string; sha: string } {
  writeFileSync(join(repo, file), content);
  git(['add', file]);
  const output = git(['commit', '-m', message, ...extra]);
  return { output, sha: git(['rev-parse', 'HEAD']) };
}

function entry(id: string, createdAt: string, fields: Partial<WorkLogEntry>): WorkLogEntry {
  return { id, createdAt, label: 'Bash', tone: 'tool', ...fields };
}

function parsed(workLog: WorkLogEntry[], messages: ConversationDiffParseResult['messages'] = []): ConversationDiffParseResult {
  return { messages, workLog, fileEditsByAssistantId: new Map() };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-5288-change-commits-'));
  repo = join(root, 'repo');
  git(['init', '--quiet', '-b', 'main', repo], root);
  git(['commit', '--quiet', '--allow-empty', '-m', 'base']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listConversationCommits', () => {
  it('finds trailer commits by the session name and never by the bare name (D-16)', async () => {
    const hit = commitFile('a.txt', 'a\n', 'with session trailer', ['--trailer', 'Overdeck-Conversation: conv-n1']);
    commitFile('b.txt', 'b\n', 'with bare-name trailer', ['--trailer', 'Overdeck-Conversation: n1']);

    const { commits, toolOutputOnly } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-n1', since: SINCE, parsed: parsed([]),
    });

    expect(commits.map((c) => c.sha)).toEqual([hit.sha]);
    expect(commits[0]).toMatchObject({
      shortSha: hit.sha.slice(0, 7),
      subject: 'with session trailer',
      attribution: 'trailer',
      pushed: false,
      files: [{ path: 'a.txt', status: 'A', additions: 1, deletions: 0 }],
    });
    expect(toolOutputOnly.size).toBe(0);
  });

  it('finds tool-output commits from a Bash entry and from a Codex-shaped entry', async () => {
    const bash = commitFile('a.txt', 'a\n', 'bash commit');
    const codex = commitFile('b.txt', 'b\n', 'codex commit');
    const workLog = [
      entry('e1', '2026-11-14T11:00:00Z', { toolInput: { command: 'git add a.txt && git commit -m "bash commit"' }, result: bash.output }),
      entry('e2', '2026-11-14T11:01:00Z', { command: 'git commit -am "codex commit"', result: `${codex.output}\n 1 file changed` }),
    ];

    const { commits, toolOutputOnly } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-tool', since: SINCE, parsed: parsed(workLog),
    });

    expect(commits.map((c) => [c.sha, c.attribution])).toEqual([
      [codex.sha, 'tool-output'],
      [bash.sha, 'tool-output'],
    ]);
    expect([...toolOutputOnly].sort()).toEqual([bash.sha, codex.sha].sort());
  });

  it('drops an amended commit and keeps its replacement when another tool result printed it', async () => {
    const original = commitFile('a.txt', 'a\n', 'first try');
    writeFileSync(join(repo, 'a.txt'), 'a\nb\n');
    git(['add', 'a.txt']);
    const amendOutput = git(['commit', '--amend', '-m', 'second try']);
    const amended = git(['rev-parse', 'HEAD']);
    // The old object still resolves until gc; only reachability drops it.
    expect(git(['cat-file', '-t', original.sha])).toBe('commit');

    const workLog = [
      entry('e1', '2026-11-14T11:00:00Z', { toolInput: { command: 'git commit -m "first try"' }, result: original.output }),
      entry('e2', '2026-11-14T11:01:00Z', { toolInput: { command: 'git commit --amend -m "second try"' }, result: amendOutput }),
    ];

    const { commits } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-amend', since: SINCE, parsed: parsed(workLog),
    });

    expect(commits.map((c) => c.sha)).toEqual([amended]);
    expect(commits[0]?.subject).toBe('second try');
  });

  it('lists a commit found by both trailer and tool output once, as trailer', async () => {
    const both = commitFile('a.txt', 'a\n', 'both ways', ['--trailer', 'Overdeck-Conversation: conv-both']);
    const workLog = [entry('e1', '2026-11-14T11:00:00Z', { toolInput: { command: 'git commit -m "both ways"' }, result: both.output })];

    const { commits, toolOutputOnly } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-both', since: SINCE, parsed: parsed(workLog),
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ sha: both.sha, attribution: 'trailer' });
    expect(toolOutputOnly.size).toBe(0);
  });

  it('marks commits on the upstream pushed and later ones local; without an upstream every commit is local', async () => {
    const first = commitFile('a.txt', 'a\n', 'first', ['--trailer', 'Overdeck-Conversation: conv-push']);

    const noUpstream = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-push', since: SINCE, parsed: null,
    });
    expect(noUpstream.commits.map((c) => c.pushed)).toEqual([false]);
    expect((await listLocalShas(repo)).hasUpstream).toBe(false);

    const origin = join(root, 'origin.git');
    git(['init', '--quiet', '--bare', origin], root);
    git(['remote', 'add', 'origin', origin]);
    git(['push', '--quiet', '-u', 'origin', 'main']);
    const second = commitFile('b.txt', 'b\n', 'second', ['--trailer', 'Overdeck-Conversation: conv-push']);

    const { commits } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-push', since: SINCE, parsed: null,
    });
    expect(commits.map((c) => [c.sha, c.pushed])).toEqual([
      [second.sha, false],
      [first.sha, true],
    ]);
    const local = await listLocalShas(repo);
    expect(local.hasUpstream).toBe(true);
    expect([...local.shas]).toEqual([second.sha]);
  });

  it('maps a tool-output commit to the turn of its tool entry', async () => {
    const made = commitFile('a.txt', 'a\n', 'in turn two');
    const messages: ConversationDiffParseResult['messages'] = [
      { role: 'user', id: 'u1', createdAt: '2026-11-14T11:00:00Z' },
      { role: 'assistant', id: 'a1', createdAt: '2026-11-14T11:01:00Z' },
      { role: 'user', id: 'u2', createdAt: '2026-11-14T11:10:00Z' },
      { role: 'assistant', id: 'a2', createdAt: '2026-11-14T11:11:00Z' },
      { role: 'assistant', id: 'a3', createdAt: '2026-11-14T11:13:00Z' },
    ];
    const workLog = [entry('e1', '2026-11-14T11:12:00Z', { toolInput: { command: 'git commit -m x' }, result: made.output })];

    const { commits } = await listConversationCommits({
      repoRoot: repo, sessionName: 'conv-turn', since: SINCE, parsed: parsed(workLog, messages),
    });

    expect(commits[0]?.turnId).toBe('a3');
  });
});

describe('toolOutputCommitCandidates', () => {
  it('reads every [branch sha] line of a git commit result and ignores other commands', () => {
    const candidates = toolOutputCommitCandidates([
      entry('e1', 't1', {
        toolInput: { command: 'git commit -m one && git commit --allow-empty -m two' },
        result: '[main (root-commit) abc1234] one\n 1 file changed\n[feature/x 1234abcd] two',
      }),
      entry('e2', 't2', { toolInput: { command: 'git log --oneline' }, result: '[main abc9999] looks like a commit' }),
    ]);
    expect(candidates).toEqual([
      { shortSha: 'abc1234', at: 't1' },
      { shortSha: '1234abcd', at: 't1' },
    ]);
  });
});

describe('turnIdAt', () => {
  const messages: ConversationDiffParseResult['messages'] = [
    { role: 'user', id: 'u1', createdAt: '2026-11-14T11:00:00Z' },
    { role: 'assistant', id: 'a1', createdAt: '2026-11-14T11:01:00Z' },
    { role: 'user', id: 'u2', createdAt: '2026-11-14T11:10:00Z' },
    { role: 'assistant', id: 'a2', createdAt: '2026-11-14T11:11:00Z' },
    { role: 'assistant', id: 'a3', createdAt: '2026-11-14T11:12:00Z' },
    { role: 'user', id: 'u3', createdAt: '2026-11-14T11:20:00Z' },
    { role: 'assistant', id: 'a4', createdAt: '2026-11-14T11:21:00Z' },
  ];

  it("returns turn two's last assistant id for a time inside turn two", () => {
    expect(turnIdAt(messages, '2026-11-14T11:11:30Z')).toBe('a3');
  });

  it('returns the last candidate in editTurnIds when one is present', () => {
    expect(turnIdAt(messages, '2026-11-14T11:11:30Z', new Set(['a2', 'a4']))).toBe('a2');
  });

  it('returns undefined for a time before any assistant message', () => {
    expect(turnIdAt(messages, '2026-11-14T10:00:00Z')).toBeUndefined();
  });
});

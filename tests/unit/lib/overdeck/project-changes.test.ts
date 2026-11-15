/**
 * PAN-5288 WI-4: recent default-branch commits of a project with who made
 * them, including trailers that squash merges moved into the body.
 *
 * Fixture git calls run isolated from the session running the tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectsMocks = vi.hoisted(() => ({ getProjectSync: vi.fn() }));
vi.mock('../../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects.js')>('../../../../src/lib/projects.js');
  return { ...actual, getProjectSync: projectsMocks.getProjectSync };
});

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

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function head(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']);
}

function createRepo(name: string): string {
  const repo = join(root, name);
  git(root, ['init', '--quiet', '-b', 'main', repo]);
  return repo;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-5288-project-changes-'));
  const home = join(root, 'overdeck-home');
  mkdirSync(home, { recursive: true });
  process.env.OVERDECK_HOME = home;
  projectsMocks.getProjectSync.mockReset();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(root, { recursive: true, force: true });
});

describe('attributeCommit', () => {
  it('finds a conversation trailer that a squash merge moved into the body', async () => {
    const { attributeCommit } = await import('../../../../src/lib/overdeck/project-changes.js');
    const body = [
      'feat: thing (#12)',
      '',
      '* first sub-commit',
      '',
      'Overdeck-Conversation: conv-x',
      '',
      'Co-authored-by: Someone <someone@example.test>',
    ].join('\n');
    expect(attributeCommit({ conversationTrailers: [], agentTrailers: [], body })).toEqual({ source: 'conversation', value: 'conv-x' });
  });

  it('prefers a final-paragraph conversation trailer over an agent trailer, then agent, then none', async () => {
    const { attributeCommit } = await import('../../../../src/lib/overdeck/project-changes.js');
    expect(attributeCommit({ conversationTrailers: ['conv-a'], agentTrailers: ['agent-pan-1'], body: '' }))
      .toEqual({ source: 'conversation', value: 'conv-a' });
    expect(attributeCommit({ conversationTrailers: [], agentTrailers: ['agent-pan-1'], body: 'x\n\nOverdeck-Conversation: conv-b' }))
      .toEqual({ source: 'agent', value: 'agent-pan-1' });
    expect(attributeCommit({ conversationTrailers: [], agentTrailers: [], body: 'x\n\n  Overdeck-Agent: planning-pan-7  ' }))
      .toEqual({ source: 'agent', value: 'planning-pan-7' });
    expect(attributeCommit({ conversationTrailers: [], agentTrailers: [], body: 'plain message' })).toBeNull();
  });
});

describe('byForAttribution', () => {
  it("maps a registered conversation's session name to its name and title, and an agent id to its issue", async () => {
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { byForAttribution } = await import('../../../../src/lib/overdeck/project-changes.js');
    createConversation({ name: 'x', tmuxSession: 'conv-x', cwd: root, title: 'Fix the dock' });

    expect(byForAttribution({ source: 'conversation', value: 'conv-x' })).toEqual({ kind: 'conversation', id: 'x', title: 'Fix the dock' });
    expect(byForAttribution({ source: 'conversation', value: 'conv-gone' })).toEqual({ kind: 'conversation', id: 'gone', title: 'conv-gone' });
    expect(byForAttribution({ source: 'agent', value: 'agent-pan-12' })).toEqual({ kind: 'agent', id: 'agent-pan-12', title: 'PAN-12' });
    expect(byForAttribution(null)).toEqual({ kind: 'unattributed' });
  });
});

describe('parseSince', () => {
  const NOW = Date.parse('2026-11-14T12:00:00.000Z');

  it('accepts relative days and hours, an ISO date, and null as 7 days', async () => {
    const { parseSince } = await import('../../../../src/lib/overdeck/project-changes.js');
    expect(parseSince('7d', NOW)).toEqual({ ok: true, iso: '2026-11-07T12:00:00.000Z' });
    expect(parseSince('12h', NOW)).toEqual({ ok: true, iso: '2026-11-14T00:00:00.000Z' });
    expect(parseSince('2026-11-01T00:00:00Z', NOW)).toEqual({ ok: true, iso: '2026-11-01T00:00:00.000Z' });
    expect(parseSince(null, NOW)).toEqual({ ok: true, iso: '2026-11-07T12:00:00.000Z' });
  });

  it('rejects more than 90 days and unparseable values', async () => {
    const { parseSince } = await import('../../../../src/lib/overdeck/project-changes.js');
    expect(parseSince('91d', NOW)).toEqual({ ok: false });
    expect(parseSince('abc', NOW)).toEqual({ ok: false });
  });
});

describe('getProjectChanges', () => {
  it('lists first-parent commits of origin/main with their author attribution', async () => {
    const repo = createRepo('with-origin');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '--quiet', '-m', 'by agent', '--trailer', 'Overdeck-Agent: agent-pan-12']);
    const agentSha = head(repo);
    git(repo, ['checkout', '--quiet', '-b', 'side']);
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'side work', '--trailer', 'Overdeck-Conversation: conv-side']);
    const sideSha = head(repo);
    git(repo, ['checkout', '--quiet', 'main']);
    git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge side', 'side']);
    const mergeSha = head(repo);
    const origin = join(root, 'origin.git');
    git(root, ['init', '--quiet', '--bare', origin]);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '--quiet', '-u', 'origin', 'main']);
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'local only']);
    projectsMocks.getProjectSync.mockImplementation((key: string) => (key === 'wfx' ? { name: 'WFX', path: repo } : null));

    const { getProjectChanges, parseSince } = await import('../../../../src/lib/overdeck/project-changes.js');
    const since = parseSince(null, Date.now());
    if (!since.ok) throw new Error('since');
    const result = await getProjectChanges('wfx', { sinceIso: since.iso });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.projectKey).toBe('wfx');
    expect(result.body.branch).toBe('main');
    expect(result.body.commits.map((c) => [c.sha, c.by])).toEqual([
      [mergeSha, { kind: 'unattributed' }],
      [agentSha, { kind: 'agent', id: 'agent-pan-12', title: 'PAN-12' }],
    ]);
    expect(result.body.commits.map((c) => c.sha)).not.toContain(sideSha);
    expect(result.body.commits[0]?.shortSha).toBe(mergeSha.slice(0, 7));
  });

  it('falls back to local main without a remote', async () => {
    const repo = createRepo('no-origin');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'only', '--trailer', 'Overdeck-Conversation: conv-local']);
    projectsMocks.getProjectSync.mockImplementation(() => ({ name: 'Local', path: repo }));

    const { getProjectChanges } = await import('../../../../src/lib/overdeck/project-changes.js');
    const result = await getProjectChanges('local', { sinceIso: new Date(Date.now() - 86_400_000).toISOString() });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.commits.map((c) => [c.subject, c.by])).toEqual([
      ['only', { kind: 'conversation', id: 'local', title: 'conv-local' }],
    ]);
  });

  it('returns 404 for an unknown project key', async () => {
    projectsMocks.getProjectSync.mockReturnValue(null);
    const { getProjectChanges } = await import('../../../../src/lib/overdeck/project-changes.js');
    expect(await getProjectChanges('nope', { sinceIso: new Date().toISOString() })).toEqual({
      status: 404,
      body: { error: 'Project not found' },
    });
  });
});

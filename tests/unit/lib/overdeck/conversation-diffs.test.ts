import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testRoot: string;
let testHome: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    },
  });
}

function createRepo(name: string, relativePath: string, content: string): string {
  const repo = join(testRoot, name);
  const filePath = join(repo, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(filePath, content);
  git(repo, ['add', relativePath]);
  git(repo, ['commit', '--quiet', '-m', 'initial']);
  return repo;
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'pan-2844-conversation-diffs-'));
  testHome = join(testRoot, 'home');
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testRoot, { recursive: true, force: true });
});

describe('getConversationDiffTurn', () => {
  it('returns the patch for a tracked edit in a different repository than the conversation cwd', async () => {
    const cwdRepo = createRepo('cwd-repo', 'README.md', 'cwd repo\n');
    const cwdFile = join(cwdRepo, 'README.md');
    const externalRepo = createRepo('state-repo', 'drafts/pan-2842.md', '# Draft\n');
    const externalFile = join(externalRepo, 'drafts/pan-2842.md');
    const sessionFile = join(testRoot, 'session.jsonl');
    writeFileSync(sessionFile, '');

    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffFull, getConversationDiffTurn } = await import(
      '../../../../src/lib/overdeck/conversation-diffs.js'
    );
    createConversation({ name: 'cross-repo', tmuxSession: 'conv-cross-repo', cwd: cwdRepo });
    writeFileSync(cwdFile, 'cwd repo\nlocal change\n');
    writeFileSync(externalFile, '# Draft\n\nExternal change\n');

    const deps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => ({
        messages: [{ role: 'assistant' as const, id: 'assistant-1', createdAt: new Date().toISOString() }],
        fileEditsByAssistantId: new Map([
          ['assistant-1', [{ filePath: cwdFile }, { filePath: externalFile }]],
        ]),
      }),
    };
    const result = await getConversationDiffTurn(
      'cross-repo',
      'conv-turn-assistant-1',
      'drafts/pan-2842.md',
      deps,
    );

    expect(result.status).toBeUndefined();
    expect(result.body).toMatchObject({ turnId: 'conv-turn-assistant-1' });
    const diff = (result.body as { diff: string }).diff;
    expect(diff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');
    expect(diff).toContain('+External change');

    const combinedResult = await getConversationDiffTurn(
      'cross-repo',
      'conv-turn-assistant-1',
      undefined,
      deps,
    );
    const combinedDiff = (combinedResult.body as { diff: string }).diff;
    expect(combinedDiff).toContain('diff --git a/README.md b/README.md');
    expect(combinedDiff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');

    const fullResult = await getConversationDiffFull('cross-repo', deps);
    const fullDiff = (fullResult.body as { diff: string }).diff;
    expect(fullDiff).toContain('diff --git a/README.md b/README.md');
    expect(fullDiff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');
    expect(fullDiff).toContain('+External change');
  });
});

describe('ignoreWhitespace in the conversation diff views (PAN-4503)', () => {
  const emptyDeps = (sessionFile: string) => ({
    resolveSessionFile: async () => sessionFile,
    getCachedMessages: async () => ({ messages: [] }),
  });

  async function createReindentConversation(name: string): Promise<string> {
    const repo = createRepo(`${name}-repo`, 'a.js', 'if (x) {\nfoo()\n}\n');
    writeFileSync(join(repo, 'b.txt'), 'hi\n');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '--quiet', '-m', 'add b']);
    const sessionFile = join(testRoot, `${name}.jsonl`);
    writeFileSync(sessionFile, '');

    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    createConversation({ name, tmuxSession: `conv-${name}`, cwd: repo });
    writeFileSync(join(repo, 'a.js'), 'if (x) {\n    foo()\n}\n');
    writeFileSync(join(repo, 'b.txt'), 'hi\nthere\n');
    return sessionFile;
  }

  it('drops the re-indent-only file from the all-turns and vs-main patches', async () => {
    const sessionFile = await createReindentConversation('ws-fns');
    const { getConversationDiffFull, getConversationDiffTurn } = await import(
      '../../../../src/lib/overdeck/conversation-diffs.js'
    );
    const deps = emptyDeps(sessionFile);

    const ignored = (await getConversationDiffFull('ws-fns', deps, { ignoreWhitespace: true })).body as { diff: string };
    expect(ignored.diff).toContain('b.txt');
    expect(ignored.diff).not.toContain('a.js');

    const plain = (await getConversationDiffFull('ws-fns', deps)).body as { diff: string };
    expect(plain.diff).toContain('b.txt');
    expect(plain.diff).toContain('a.js');

    const turn = (await getConversationDiffTurn('ws-fns', 'vs-main', undefined, deps, { ignoreWhitespace: true }))
      .body as { diff: string };
    expect(turn.diff).toContain('b.txt');
    expect(turn.diff).not.toContain('a.js');
  });

  it('serves /diffs/full?ignoreWhitespace=1 without the re-indent-only file', async () => {
    await createReindentConversation('ws-route');
    const { conversationDiffRoutes } = await import(
      '../../../../src/dashboard/server/routes/conversation-diffs.js'
    );
    const request = HttpServerRequest.fromWeb(
      new Request('http://overdeck.localhost/api/conversations/ws-route/diffs/full?ignoreWhitespace=1'),
    );
    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(HttpRouter.toHttpEffect(conversationDiffRoutes), (app) =>
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
        ),
      ),
    );
    expect(response.status).toBe(200);
    const responseBody = response.body as { body?: Uint8Array } | null;
    const body = JSON.parse(new TextDecoder().decode(responseBody?.body)) as { diff: string };
    expect(body.diff).toContain('b.txt');
    expect(body.diff).not.toContain('a.js');
  });
});

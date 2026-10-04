import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDiffCompareRoutes } from '../../../../../src/dashboard/server/routes/diff-compare.js';

let tmpRoot: string;
let outsideRoot: string;
let repo: string;
let shaA: string;
let shaB: string;
let commitDay = 1;

function git(cwd: string, ...args: string[]): string {
  const date = `2020-01-${String(commitDay).padStart(2, '0')}T00:00:00Z`;
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    },
  });
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
  commitDay += 1;
  return git(cwd, 'rev-parse', 'HEAD').trim();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
}

const routes = () => createDiffCompareRoutes({ allowedRoots: async () => ({ containing: [tmpRoot], exact: [] }) });

async function get(path: string): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://overdeck.localhost${path}`));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(routes()), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '';
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function compareUrl(params: Record<string, string>, repoPath = repo): string {
  return `/api/diffs/compare?${new URLSearchParams({ repo: repoPath, ...params }).toString()}`;
}

beforeAll(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pan-4503-route-')));
  outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pan-4503-outside-')));
  repo = join(tmpRoot, 'repo');
  initRepo(repo);

  writeFileSync(join(repo, 'a.js'), 'if (x) {\nfoo()\n}\n');
  writeFileSync(join(repo, 'b.txt'), 'hi\n');
  shaA = commit(repo, 'A');
  writeFileSync(join(repo, 'a.js'), 'if (x) {\n    foo()\n}\n');
  writeFileSync(join(repo, 'b.txt'), 'hi\nthere\n');
  writeFileSync(join(repo, 'c.md'), '# c\n');
  shaB = commit(repo, 'B');

  git(repo, 'checkout', '-q', '-b', 'left');
  writeFileSync(join(repo, 'l.txt'), 'left\n');
  commit(repo, 'left');
  git(repo, 'checkout', '-q', '-b', 'right', shaB);
  writeFileSync(join(repo, 'r.txt'), 'right\n');
  commit(repo, 'right');

  git(repo, 'checkout', '-q', '--orphan', 'unrelated');
  git(repo, 'rm', '-rfq', '.');
  writeFileSync(join(repo, 'u.txt'), 'unrelated\n');
  commit(repo, 'unrelated');

  git(repo, 'checkout', '-q', 'main');
  git(repo, 'tag', '-a', 'v1', '-m', 'v1', shaA);
  git(repo, 'update-ref', 'refs/pan/turn/agent-ws/t1', shaB);

  initRepo(join(outsideRoot, 'repo'));
  writeFileSync(join(outsideRoot, 'repo', 'o.txt'), 'o\n');
  commit(join(outsideRoot, 'repo'), 'outside');
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe('GET /api/diffs/compare (PAN-4503)', () => {
  it('compares two commits of a repo with no remote', async () => {
    expect(git(repo, 'remote').trim()).toBe('');
    const { status, body } = await get(compareUrl({ base: shaA, head: shaB }));
    expect(status).toBe(200);
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(['a.js', 'b.txt', 'c.md']);
    expect(body.base).toEqual({ ref: shaA, sha: shaA });
    expect(body.head).toEqual({ ref: shaB, sha: shaB });
    expect(body.mode).toBe('two-dot');
    expect(body.mergeBase).toBeNull();
    expect(body.repoRoot).toBe(repo);
    expect(body).not.toHaveProperty('diff');
  });

  it('returns the patch for one requested file', async () => {
    const { status, body } = await get(compareUrl({ base: shaA, head: shaB, file: 'b.txt' }));
    expect(status).toBe(200);
    expect(body.diff).toContain('+there');
    expect(body.diff).not.toContain('a.js');
  });

  it('drops whitespace-only files with ignoreWhitespace=1', async () => {
    const { status, body } = await get(compareUrl({ base: 'v1', head: 'main', ignoreWhitespace: '1' }));
    expect(status).toBe(200);
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(['b.txt', 'c.md']);
    expect(body.base).toEqual({ ref: 'v1', sha: shaA });
  });

  it('distinguishes two-dot from three-dot on diverged branches', async () => {
    const twoDot = await get(compareUrl({ base: 'left', head: 'right', mode: 'two-dot' }));
    expect(twoDot.status).toBe(200);
    expect(twoDot.body.files).toEqual([
      { path: 'l.txt', kind: 'D', additions: 0, deletions: 1 },
      { path: 'r.txt', kind: 'A', additions: 1, deletions: 0 },
    ]);

    const threeDot = await get(compareUrl({ base: 'left', head: 'right', mode: 'three-dot' }));
    expect(threeDot.status).toBe(200);
    expect(threeDot.body.files.map((f: { path: string }) => f.path)).toEqual(['r.txt']);
    expect(threeDot.body.mergeBase).toBe(shaB);
  });

  it.each([
    ['an option-shaped ref', { base: '-n', head: 'main' }, 'INVALID_REF'],
    ['an unknown ref', { base: 'nope', head: 'main' }, 'UNKNOWN_REF'],
    ['a bad mode', { base: 'left', head: 'right', mode: 'four-dot' }, 'INVALID_MODE'],
    ['unrelated histories in three-dot mode', { base: 'main', head: 'unrelated', mode: 'three-dot' }, 'NO_MERGE_BASE'],
  ])('returns 400 for %s', async (_label, params, code) => {
    const { status, body } = await get(compareUrl(params));
    expect(status).toBe(400);
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 REPO_NOT_ALLOWED for a repo outside the allowed roots', async () => {
    const { status, body } = await get(compareUrl({ base: 'HEAD~0', head: 'HEAD' }, join(outsideRoot, 'repo')));
    expect(status).toBe(400);
    expect(body.code).toBe('REPO_NOT_ALLOWED');
  });
});

describe('GET /api/diffs/refs (PAN-4503)', () => {
  it('lists branches, peeled tags and recent commits, and never checkpoint refs', async () => {
    const { status, body } = await get(`/api/diffs/refs?${new URLSearchParams({ repo }).toString()}`);
    expect(status).toBe(200);
    expect(body.repoRoot).toBe(repo);
    expect(body.head).toEqual({ branch: 'main', sha: shaB });

    const branchNames = body.branches.map((b: { name: string }) => b.name);
    expect(branchNames).toEqual(expect.arrayContaining(['main', 'left', 'right', 'unrelated']));
    expect(body.branches.every((b: { remote: boolean }) => b.remote === false)).toBe(true);

    expect(body.tags).toEqual([{ name: 'v1', sha: shaA }]);

    const newest = git(repo, 'log', '--branches', '--tags', '--date-order', '-n', '1', '--format=%H').trim();
    expect(body.commits[0].sha).toBe(newest);
    expect(body.commits[0]).toMatchObject({ shortSha: expect.any(String), subject: 'unrelated', date: expect.any(String) });

    expect(JSON.stringify(body)).not.toContain('refs/pan');
    expect(branchNames.some((name: string) => name.includes('agent-ws'))).toBe(false);
  });

  it('returns 400 REPO_NOT_ALLOWED for a repo outside the allowed roots', async () => {
    const { status, body } = await get(`/api/diffs/refs?${new URLSearchParams({ repo: join(outsideRoot, 'repo') }).toString()}`);
    expect(status).toBe(400);
    expect(body.code).toBe('REPO_NOT_ALLOWED');
  });
});

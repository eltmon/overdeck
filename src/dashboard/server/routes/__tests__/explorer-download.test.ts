/** PAN-5188 WI-2: GET /api/explorer/download streams file bytes with single-range support and hardened headers. */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Option } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { explorerError } from '../../services/explorer/errors.js';
import { DOWNLOAD_CSP } from '../../services/explorer/download-headers.js';
import type { ExplorerRoot } from '../../services/explorer/roots.js';
import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { handleExplorerDownload, parseRange } from '../explorer.js';

const execFileAsync = promisify(execFile);
const TOKEN = 'explorer-download-internal-token';
const BODY = 'hello, explorer';

let dir: string;
let root: ExplorerRoot;

function fakeRequest(query: string, headers: Record<string, string> = {}, credential = true) {
  return {
    method: 'GET',
    url: `/api/explorer/download?${query}`,
    headers: credential ? { [INTERNAL_TOKEN_HEADER]: TOKEN, ...headers } : headers,
    remoteAddress: Option.none(),
  } as unknown as Parameters<typeof handleExplorerDownload>[0];
}

const resolveExplorerRoot = vi.fn(async (_rootId: string) => root);

async function download(path: string, extra: { query?: string; headers?: Record<string, string> } = {}) {
  const query = `root=issue:PAN-1&path=${encodeURIComponent(path)}${extra.query ?? ''}`;
  const response = HttpServerResponse.toWeb(
    await handleExplorerDownload(fakeRequest(query, extra.headers), { resolveExplorerRoot }),
  );
  return { response, status: response.status, headers: response.headers, body: await response.text() };
}

beforeEach(async () => {
  process.env.OVERDECK_INTERNAL_TOKEN = TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  dir = await realpath(await mkdtemp(join(tmpdir(), 'pan-5188-download-')));
  root = { kind: 'issue', id: 'issue:PAN-1', absPath: dir, writable: true, projectKey: 'p', defaultBranch: 'main' };
  resolveExplorerRoot.mockClear();
  await writeFile(join(dir, 'note.txt'), BODY);
  await writeFile(join(dir, 'empty.txt'), '');
  await writeFile(join(dir, 'page.html'), '<script>alert(1)</script>');
  await writeFile(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await mkdir(join(dir, 'sub'));
});

afterEach(async () => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  await rm(dir, { recursive: true, force: true });
});

describe('parseRange', () => {
  it.each([
    [undefined, 10, { kind: 'full' }],
    ['bytes=0-3', 10, { kind: 'partial', start: 0, end: 3 }],
    ['bytes=5-', 10, { kind: 'partial', start: 5, end: 9 }],
    ['bytes=-2', 10, { kind: 'partial', start: 8, end: 9 }],
    ['bytes=-20', 10, { kind: 'partial', start: 0, end: 9 }],
    ['bytes=2-99', 10, { kind: 'partial', start: 2, end: 9 }],
    ['bytes=0-1,4-5', 10, { kind: 'full' }],
    ['bytes=5-2', 10, { kind: 'full' }],
    ['items=0-1', 10, { kind: 'full' }],
    ['bytes=-', 10, { kind: 'full' }],
    ['bytes=10-', 10, { kind: 'unsatisfiable' }],
    ['bytes=0-', 0, { kind: 'unsatisfiable' }],
    ['bytes=-0', 10, { kind: 'unsatisfiable' }],
  ] as const)('%s on %d bytes', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});

describe('handleExplorerDownload', () => {
  it('streams a file with 200, its exact bytes and Content-Length', async () => {
    const result = await download('note.txt');
    expect(result.status).toBe(200);
    expect(result.body).toBe(BODY);
    expect(result.headers.get('content-length')).toBe(String(BODY.length));
    expect(result.headers.get('accept-ranges')).toBe('bytes');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('answers Range: bytes=0-3 with 206 and four bytes', async () => {
    const result = await download('note.txt', { headers: { range: 'bytes=0-3' } });
    expect(result.status).toBe(206);
    expect(result.headers.get('content-range')).toBe(`bytes 0-3/${BODY.length}`);
    expect(result.headers.get('content-length')).toBe('4');
    expect(result.body).toBe('hell');
  });

  it('serves open-ended and suffix ranges, and ignores a multi-range header', async () => {
    expect((await download('note.txt', { headers: { range: 'bytes=5-' } })).body).toBe(BODY.slice(5));
    expect((await download('note.txt', { headers: { range: 'bytes=-2' } })).body).toBe(BODY.slice(-2));
    const multi = await download('note.txt', { headers: { range: 'bytes=0-1,4-5' } });
    expect(multi.status).toBe(200);
    expect(multi.body).toBe(BODY);
  });

  it('answers 416 with bytes */<size> when the range is unsatisfiable', async () => {
    const past = await download('note.txt', { headers: { range: `bytes=${BODY.length}-` } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${BODY.length}`);
    expect(past.body).toBe('');
    expect(past.headers.get('content-security-policy')).toBe(DOWNLOAD_CSP);

    const empty = await download('empty.txt', { headers: { range: 'bytes=0-' } });
    expect(empty.status).toBe(416);
    expect(empty.headers.get('content-range')).toBe('bytes */0');
  });

  it('streams an empty file with 200 and no range', async () => {
    const result = await download('empty.txt');
    expect(result.status).toBe(200);
    expect(result.body).toBe('');
    expect(result.headers.get('content-length')).toBe('0');
  });

  it('serves .html with inline=1 as text/plain with nosniff and the sandbox CSP', async () => {
    const result = await download('page.html', { query: '&inline=1' });
    expect(result.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('content-security-policy')).toBe(DOWNLOAD_CSP);
  });

  it('serves .png with inline=1 as inline and ignores extra query parameters', async () => {
    const result = await download('pic.png', { query: '&inline=1&rev=abc' });
    expect(result.headers.get('content-type')).toBe('image/png');
    expect(result.headers.get('content-disposition')).toMatch(/^inline/u);
  });

  it('refuses a request without a credential with 401 before resolving the root', async () => {
    const response = await handleExplorerDownload(fakeRequest('root=issue:PAN-1&path=note.txt', {}, false), {
      resolveExplorerRoot,
    });
    expect(response.status).toBe(401);
    expect(resolveExplorerRoot).not.toHaveBeenCalled();
  });

  it('answers 400 without a root', async () => {
    const response = await handleExplorerDownload(fakeRequest('path=note.txt'), { resolveExplorerRoot });
    expect(response.status).toBe(400);
  });

  it('maps resolver errors to HTTP status with their code', async () => {
    const outside = await handleExplorerDownload(fakeRequest('root=issue:PAN-1&path=x'), {
      resolveExplorerRoot,
      resolveInsideRoot: async () => {
        throw explorerError('PATH_OUTSIDE_ROOT', 'outside');
      },
    });
    expect(outside.status).toBe(400);
    expect(JSON.parse(await HttpServerResponse.toWeb(outside).text())).toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });

    const missingRoot = await handleExplorerDownload(fakeRequest('root=issue:PAN-404&path=x'), {
      resolveExplorerRoot: async () => {
        throw explorerError('ROOT_NOT_FOUND', 'no root');
      },
    });
    expect(missingRoot.status).toBe(404);
    expect(JSON.parse(await HttpServerResponse.toWeb(missingRoot).text())).toMatchObject({ code: 'ROOT_NOT_FOUND' });
  });

  it('answers 404 for a missing file, a directory and the root itself', async () => {
    expect((await download('nope.txt')).status).toBe(404);
    expect((await download('sub')).status).toBe(404);
    expect((await download('')).status).toBe(404);
  });

  it('answers 404 for a FIFO without hanging', async () => {
    if (process.platform === 'win32') return;
    await execFileAsync('mkfifo', [join(dir, 'pipe')]);
    const result = await download('pipe');
    expect(result.status).toBe(404);
  });
});

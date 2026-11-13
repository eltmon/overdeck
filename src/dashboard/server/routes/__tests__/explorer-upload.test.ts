/** PAN-5188 WI-5: POST /api/explorer/upload writes one new file, capped and no-clobber. */
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { explorerError } from '../../services/explorer/errors.js';
import type { ExplorerRoot } from '../../services/explorer/roots.js';
import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { handleExplorerUpload } from '../explorer.js';

const TOKEN = 'explorer-upload-internal-token';

let dir: string;
let root: ExplorerRoot;
const resolveExplorerRoot = vi.fn(async (_rootId: string) => root);

function fakeRequest(query: string, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    url: `/api/explorer/upload?${query}`,
    headers: { [INTERNAL_TOKEN_HEADER]: TOKEN, 'content-type': 'application/octet-stream', ...headers },
    remoteAddress: Option.none(),
  } as unknown as Parameters<typeof handleExplorerUpload>[0];
}

async function* chunksOf(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield Buffer.from(part);
}

async function upload(query: string, chunks: AsyncIterable<Uint8Array>, extra: Parameters<typeof handleExplorerUpload>[2] = {}, headers: Record<string, string> = {}) {
  const response = await handleExplorerUpload(fakeRequest(query, headers), chunks, { resolveExplorerRoot, ...extra });
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

beforeEach(async () => {
  process.env.OVERDECK_INTERNAL_TOKEN = TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  dir = await realpath(await mkdtemp(join(tmpdir(), 'pan-5188-upload-route-')));
  root = { kind: 'issue', id: 'issue:PAN-1', absPath: dir, writable: true, projectKey: 'p', defaultBranch: 'main' };
  resolveExplorerRoot.mockClear();
  await mkdir(join(dir, 'dir'));
});

afterEach(async () => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  await rm(dir, { recursive: true, force: true });
});

describe('handleExplorerUpload', () => {
  it('writes the body to <dir>/<name> and answers 201 with path, size and mtimeMs', async () => {
    const result = await upload('root=issue:PAN-1&dir=dir&name=x.bin', chunksOf('abc', 'def'));
    expect(result.status).toBe(201);
    expect(result.json).toEqual({ path: 'dir/x.bin', size: 6, mtimeMs: expect.any(Number) });
    expect(await readFile(join(dir, 'dir', 'x.bin'), 'utf8')).toBe('abcdef');
  });

  it('writes into the root when dir is empty', async () => {
    const result = await upload('root=issue:PAN-1&name=top.txt', chunksOf('t'));
    expect(result.json).toMatchObject({ path: 'top.txt' });
  });

  it('answers 413 from Content-Length before reading any chunk', async () => {
    const untouchable: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        throw new Error('the body must not be read');
      },
    };
    const result = await upload('root=issue:PAN-1&dir=dir&name=x.bin', untouchable, {}, { 'content-length': '104857601' });
    expect(result.status).toBe(413);
    expect(result.json).toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(resolveExplorerRoot).not.toHaveBeenCalled();
  });

  it('answers 409 ALREADY_EXISTS for an existing name and leaves it unchanged', async () => {
    await writeFile(join(dir, 'dir', 'x.bin'), 'original');
    const result = await upload('root=issue:PAN-1&dir=dir&name=x.bin', chunksOf('new'));
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await readFile(join(dir, 'dir', 'x.bin'), 'utf8')).toBe('original');
    expect((await readdir(join(dir, 'dir'))).filter((name) => name.startsWith('.overdeck-upload-'))).toEqual([]);
  });

  it('passes EDIT_WORKSPACE_REQUIRED from the resolver through as 409', async () => {
    const result = await upload('root=project:p&dir=dir&name=x.bin', chunksOf('x'), {
      resolveInsideRoot: async () => {
        throw explorerError('EDIT_WORKSPACE_REQUIRED', 'read-only');
      },
    });
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ code: 'EDIT_WORKSPACE_REQUIRED' });
  });

  it('answers 404 when the target directory is missing', async () => {
    const result = await upload('root=issue:PAN-1&dir=missing&name=x.bin', chunksOf('x'));
    expect(result.status).toBe(404);
  });

  it.each(['', '..', 'a%2Fb', 'a%5Cb', 'a%00b'])('answers 400 INVALID_NAME for name=%s', async (name) => {
    const result = await upload(`root=issue:PAN-1&dir=dir&name=${name}`, chunksOf('x'));
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: 'INVALID_NAME' });
  });

  it('refuses a body type other than application/octet-stream', async () => {
    const result = await upload('root=issue:PAN-1&dir=dir&name=x.bin', chunksOf('x'), {}, { 'content-type': 'application/json' });
    expect(result.status).toBe(400);
  });
});

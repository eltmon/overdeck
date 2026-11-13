/** PAN-5188 WI-6c: download URLs and the upload client. */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'csrf-1',
  })),
}));

const { ExplorerHttpError, explorerDownloadUrl, uploadExplorerFile } = await import('../explorer-http');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('explorerDownloadUrl', () => {
  it('encodes the root, path and rev', () => {
    expect(explorerDownloadUrl('issue:PAN-1', 'a b/c#.png', { inline: true, rev: 'x-y-3' })).toBe(
      '/api/explorer/download?root=issue%3APAN-1&path=a%20b%2Fc%23.png&inline=1&rev=x-y-3',
    );
  });

  it('omits rev and sets inline=0 for an attachment', () => {
    expect(explorerDownloadUrl('project:p', 'x.bin', { inline: false })).toBe(
      '/api/explorer/download?root=project%3Ap&path=x.bin&inline=0',
    );
  });
});

describe('uploadExplorerFile', () => {
  const file = Object.assign(new Blob(['bytes']), { name: 'photo one.png' });

  it('posts the file as octet-stream with the CSRF header', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ path: 'dir/photo one.png', size: 5, mtimeMs: 9 }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadExplorerFile('issue:PAN-1', 'dir', file)).resolves.toEqual({
      path: 'dir/photo one.png',
      size: 5,
      mtimeMs: 9,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/explorer/upload?root=issue%3APAN-1&dir=dir&name=photo%20one.png');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream', 'x-overdeck-csrf-token': 'csrf-1' });
  });

  it('throws ExplorerHttpError with the server code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'exists', code: 'ALREADY_EXISTS' }), { status: 409 })),
    );
    const error = await uploadExplorerFile('issue:PAN-1', '', file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExplorerHttpError);
    expect(error).toMatchObject({ status: 409, code: 'ALREADY_EXISTS', message: 'exists' });
  });
});

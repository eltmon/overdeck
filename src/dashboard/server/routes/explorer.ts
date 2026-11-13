/**
 * Explorer route module (PAN-5188) — Effect HttpRouter.Layer
 *
 *   GET /api/explorer/download?root=<rootId>&path=<rel>&inline=0|1
 *     Streams a regular file's bytes with single-range support (D-3) and the
 *     hardened header policy from services/explorer/download-headers.ts, or a
 *     folder as .tar.gz (services/explorer/folder-archive.ts).
 *
 *   POST /api/explorer/upload?root=<rootId>&dir=<rel>&name=<filename>
 *     Writes one new file from a raw application/octet-stream body: capped at
 *     EXPLORER_UPLOAD_MAX_BYTES, never replacing an existing file (D-6), behind
 *     the dashboard mutation guard (D-5).
 *
 * Paths resolve only through PAN-5185's resolveExplorerRoot + resolveInsideRoot
 * (FR-8). The route checks the dashboard credential itself before touching the
 * filesystem (FR-21). Handlers are exported so tests drive them directly.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { explorerError } from '../services/explorer/errors.js';
import { DOWNLOAD_CSP, contentDisposition, downloadHeaders } from '../services/explorer/download-headers.js';
import { archiveFolder } from '../services/explorer/folder-archive.js';
import { explorerErrorResponse } from '../services/explorer/http-errors.js';
import { resolveInsideRoot } from '../services/explorer/paths.js';
import { resolveExplorerRoot } from '../services/explorer/roots.js';
import { EXPLORER_UPLOAD_MAX_BYTES, openUploadSink, validateUploadName } from '../services/explorer/upload.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

export interface ExplorerRouteDeps {
  resolveExplorerRoot: typeof resolveExplorerRoot;
  resolveInsideRoot: typeof resolveInsideRoot;
  spawn: typeof spawn;
}

const defaultDeps: ExplorerRouteDeps = { resolveExplorerRoot, resolveInsideRoot, spawn };

export type ParsedRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/u;

/**
 * Parse a single-range `Range` header against a file of `size` bytes (D-3).
 * Supports `bytes=a-b`, `bytes=a-` and `bytes=-n`. A missing, malformed or
 * multi-range header is `full` (RFC 9110 lets a server ignore it).
 */
export function parseRange(header: string | undefined, size: number): ParsedRange {
  if (header === undefined) return { kind: 'full' };
  const match = RANGE_PATTERN.exec(header.trim());
  if (!match) return { kind: 'full' };
  const [, first, last] = match as unknown as [string, string, string];
  if (first === '' && last === '') return { kind: 'full' };

  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  if (last !== '' && Number(last) < start) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return { kind: 'partial', start, end };
}

function headerValue(request: HttpServerRequest.HttpServerRequest, name: string): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function handleExplorerDownload(
  request: HttpServerRequest.HttpServerRequest,
  deps: Partial<ExplorerRouteDeps> = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const authError = rejectUnauthorizedDashboardRequest(request);
  if (authError) return authError;

  const { resolveExplorerRoot: resolveRoot, resolveInsideRoot: resolveInside, spawn: spawnTar } = { ...defaultDeps, ...deps };
  const params = new URL(request.url, 'http://localhost').searchParams;
  const rootId = params.get('root');
  if (!rootId) return jsonResponse({ error: 'root is required' }, { status: 400 });
  const relPath = params.get('path') ?? '';
  const inline = params.get('inline') === '1';

  try {
    const root = await resolveRoot(rootId);
    const abs = await resolveInside(root, relPath, { forWrite: false, allowRoot: true });
    const target = await stat(abs);
    if (target.isDirectory()) {
      const name = basename(abs);
      const bytes = await archiveFolder(root, abs, { spawn: spawnTar });
      return HttpServerResponse.stream(Stream.fromAsyncIterable<Uint8Array, unknown>(bytes, (error) => error), {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': contentDisposition('attachment', `${name}.tar.gz`),
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': DOWNLOAD_CSP,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (!target.isFile()) {
      throw explorerError('NOT_FOUND', `${JSON.stringify(relPath)} is not a regular file`);
    }
    return await streamFile(abs, relPath, inline, headerValue(request, 'range'));
  } catch (error) {
    return explorerErrorResponse(error);
  }
}

async function streamFile(
  abs: string,
  relPath: string,
  inline: boolean,
  rangeHeader: string | undefined,
): Promise<HttpServerResponse.HttpServerResponse> {
  // O_NONBLOCK so a FIFO or device swapped in after stat cannot hang the open (NFR-2).
  const handle = await open(abs, constants.O_RDONLY | constants.O_NONBLOCK);
  let streaming = false;
  try {
    const st = await handle.stat();
    if (!st.isFile()) {
      throw explorerError('NOT_FOUND', `${JSON.stringify(relPath)} is not a regular file`);
    }
    const range = parseRange(rangeHeader, st.size);

    if (range.kind === 'unsatisfiable') {
      return HttpServerResponse.empty({
        status: 416,
        headers: { ...downloadHeaders(relPath, { inline, size: 0 }), 'Content-Range': `bytes */${st.size}` },
      });
    }

    const partial = range.kind === 'partial';
    const headers = downloadHeaders(relPath, { inline, size: partial ? range.end - range.start + 1 : st.size });
    if (partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${st.size}`;

    // createReadStream closes the handle when the stream ends or is destroyed (autoClose).
    const nodeStream = partial
      ? handle.createReadStream({ start: range.start, end: range.end })
      : handle.createReadStream();
    streaming = true;
    // Ending or interrupting the iterator destroys the Node stream, which closes the handle.
    const body = Stream.fromAsyncIterable<Uint8Array, unknown>(nodeStream, (error) => error);
    return HttpServerResponse.stream(body, { status: partial ? 206 : 200, headers });
  } finally {
    if (!streaming) await handle.close();
  }
}

export async function handleExplorerUpload(
  request: HttpServerRequest.HttpServerRequest,
  chunks: AsyncIterable<Uint8Array>,
  deps: Partial<ExplorerRouteDeps> = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const guardError = rejectUnsafeDashboardMutationRequest(request, { contentType: 'application/octet-stream' });
  if (guardError) return guardError;
  if (Number(headerValue(request, 'content-length') ?? 0) > EXPLORER_UPLOAD_MAX_BYTES) {
    return explorerErrorResponse(explorerError('FILE_TOO_LARGE', `upload is larger than ${EXPLORER_UPLOAD_MAX_BYTES} bytes`));
  }

  const { resolveExplorerRoot: resolveRoot, resolveInsideRoot: resolveInside } = { ...defaultDeps, ...deps };
  const params = new URL(request.url, 'http://localhost').searchParams;
  const rootId = params.get('root');
  if (!rootId) return jsonResponse({ error: 'root is required' }, { status: 400 });
  const dir = params.get('dir') ?? '';
  const name = params.get('name') ?? '';
  const invalidName = validateUploadName(name);
  if (invalidName) return jsonResponse({ error: invalidName, code: 'INVALID_NAME' }, { status: 400 });

  const rel = dir === '' ? name : `${dir}/${name}`;
  try {
    const root = await resolveRoot(rootId);
    const targetAbs = await resolveInside(root, rel, { forWrite: true });
    if (!(await stat(dirname(targetAbs))).isDirectory()) {
      throw explorerError('NOT_FOUND', `${JSON.stringify(dir)} is not a directory`);
    }
    if (await lstat(targetAbs).then(() => true, () => false)) {
      throw explorerError('ALREADY_EXISTS', `${JSON.stringify(rel)} already exists`);
    }

    const sink = await openUploadSink(targetAbs, rel);
    try {
      for await (const chunk of chunks) await sink.write(chunk);
      return jsonResponse(await sink.commit(), { status: 201 });
    } catch (error) {
      await sink.abort();
      throw error;
    }
  } catch (error) {
    return explorerErrorResponse(error);
  }
}

// ─── GET /api/explorer/download ───────────────────────────────────────────────

const downloadRoute = HttpRouter.add(
  'GET',
  '/api/explorer/download',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleExplorerDownload(request));
  })),
);

// ─── POST /api/explorer/upload ────────────────────────────────────────────────

const uploadRoute = HttpRouter.add(
  'POST',
  '/api/explorer/upload',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleExplorerUpload(request, Stream.toAsyncIterable(request.stream)));
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const explorerRouteLayer = Layer.mergeAll(downloadRoute, uploadRoute);

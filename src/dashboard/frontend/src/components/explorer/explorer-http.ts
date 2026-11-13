/**
 * Explorer HTTP client (PAN-5188 §6.8). Viewers read file bytes through the
 * download route, never over RPC (D-12); uploads post a raw body to the upload
 * route behind the dashboard CSRF header. URLs are root-relative, so the
 * session cookie authenticates <img>, <audio> and worker fetches.
 */
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

const enc = encodeURIComponent;

export function explorerDownloadUrl(rootId: string, path: string, opts: { inline: boolean; rev?: string }): string {
  return `/api/explorer/download?root=${enc(rootId)}&path=${enc(path)}&inline=${opts.inline ? 1 : 0}${
    opts.rev ? `&rev=${enc(opts.rev)}` : ''
  }`;
}

export class ExplorerHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'ExplorerHttpError';
  }
}

export async function uploadExplorerFile(
  rootId: string,
  dir: string,
  file: Blob & { name: string },
  opts: { signal?: AbortSignal } = {},
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const response = await fetch(`/api/explorer/upload?root=${enc(rootId)}&dir=${enc(dir)}&name=${enc(file.name)}`, {
    method: 'POST',
    body: file,
    headers: { ...(await dashboardMutationJsonHeaders()), 'Content-Type': 'application/octet-stream' },
    signal: opts.signal,
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    path?: string;
    size?: number;
    mtimeMs?: number;
  };
  if (!response.ok) {
    throw new ExplorerHttpError(body.error ?? `Upload failed (${response.status})`, response.status, body.code);
  }
  return { path: body.path!, size: body.size!, mtimeMs: body.mtimeMs! };
}

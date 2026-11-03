/**
 * The scope-inventory request log (PAN-4837 FR-14), installed only in a build with
 * `VITE_OVERDECK_REQUEST_LOG=1`. It wraps the shimmed `fetch` and `WebSocket` and records each
 * `/api/` request as `{ method, path, status }` (path without the query, de-duplicated) and the tag
 * of each RPC request sent on `/ws/rpc`, into `globalThis.__overdeckRequestLog`.
 */
export interface RequestLog {
  http: Array<{ method: string; path: string; status: number }>;
  rpc: string[];
}

type LogTarget = { fetch: typeof fetch; WebSocket: typeof WebSocket; __overdeckRequestLog?: RequestLog };

function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url, 'http://overdeck.invalid');
    return parsed.host === 'overdeck.invalid' || parsed.host === globalThis.location?.host ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export function installRequestLog(target: LogTarget = globalThis as unknown as LogTarget): RequestLog {
  const log: RequestLog = { http: [], rpc: [] };
  target.__overdeckRequestLog = log;
  const seen = new Set<string>();
  const record = (method: string, path: string, status: number) => {
    const key = `${method} ${path} ${status}`;
    if (seen.has(key)) return;
    seen.add(key);
    log.http.push({ method, path, status });
  };
  const recordRpc = (data: unknown) => {
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      const { _tag, tag } = (message ?? {}) as { _tag?: unknown; tag?: unknown };
      if (_tag === 'Request' && typeof tag === 'string' && !log.rpc.includes(tag)) log.rpc.push(tag);
    }
  };

  const innerFetch = target.fetch;
  target.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = pathOf(url);
    const response = await innerFetch(...args);
    if (path?.startsWith('/api/')) record(method, path, response.status);
    return response;
  }) as typeof fetch;

  const InnerWebSocket = target.WebSocket;
  target.WebSocket = class extends InnerWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (pathOf(String(url)) === '/ws/rpc') {
        const send = this.send.bind(this);
        this.send = (data: Parameters<WebSocket['send']>[0]) => {
          recordRpc(data);
          send(data);
        };
      }
    }
  } as typeof WebSocket;

  return log;
}

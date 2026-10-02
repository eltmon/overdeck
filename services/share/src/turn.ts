/**
 * Short-lived Cloudflare Realtime TURN credentials (PRD PAN-658 "TURN credentials", NFR-7).
 *
 * Credentials are minted per request and handed only to the host or an admitted viewer; the
 * reducer never routes a lobby viewer's request here. Never log the API token or the returned
 * credential.
 */
import type { IceServer } from '../../../packages/contracts/src/sharing.ts';
import type { Deps, TurnConfig } from './env.ts';

export const TURN_TTL_SECONDS = 3600;
export const TURN_FETCH_TIMEOUT_MS = 5_000;
const ICE_URL_RE = /^(stun|turn|turns):/;

export type IceServersResult =
  | { ok: true; iceServers: IceServer[] }
  | { ok: false; reason: 'not_configured' | 'http_error' | 'bad_response' | 'network_error' };

export function turnCredentialsUrl(keyId: string): string {
  return `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
}

/** A new IceServer built from known keys only, or null when the entry is malformed. */
function parseIceServer(value: unknown): IceServer | null {
  if (typeof value !== 'object' || value === null) return null;
  const { urls, username, credential } = value as Record<string, unknown>;
  if (!Array.isArray(urls) || urls.length === 0) return null;
  if (!urls.every((u): u is string => typeof u === 'string' && ICE_URL_RE.test(u))) return null;
  if (username !== undefined && typeof username !== 'string') return null;
  if (credential !== undefined && typeof credential !== 'string') return null;
  return {
    urls: [...urls],
    ...(username !== undefined ? { username } : {}),
    ...(credential !== undefined ? { credential } : {}),
  };
}

function parseIceServers(body: unknown): IceServer[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const list = (body as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: IceServer[] = [];
  for (const entry of list) {
    const server = parseIceServer(entry);
    if (!server) return null;
    out.push(server);
  }
  return out;
}

type Fetched = { kind: 'status'; status: number } | { kind: 'body'; body: unknown };

export async function fetchIceServers(turn: TurnConfig | null, deps: Pick<Deps, 'fetch'>): Promise<IceServersResult> {
  if (turn === null) return { ok: false, reason: 'not_configured' };

  // AbortController + setTimeout rather than AbortSignal.timeout(), which ignores vi.useFakeTimers().
  // The race also covers a fetch implementation that ignores the abort signal.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, TURN_FETCH_TIMEOUT_MS);
  });
  const work = (async (): Promise<Fetched> => {
    const res = await deps.fetch(turnCredentialsUrl(turn.keyId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${turn.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      signal: controller.signal,
    });
    if (res.status !== 201) return { kind: 'status', status: res.status };
    return { kind: 'body', body: await res.json().catch(() => undefined) };
  })();

  let fetched: Fetched;
  try {
    fetched = await Promise.race([work, timeout]);
  } catch {
    return { ok: false, reason: 'network_error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    work.catch(() => undefined);
  }

  if (fetched.kind === 'status') return { ok: false, reason: 'http_error' };
  const iceServers = parseIceServers(fetched.body);
  return iceServers ? { ok: true, iceServers } : { ok: false, reason: 'bad_response' };
}

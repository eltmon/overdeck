/**
 * The room-creation rate limit from the committed wrangler.jsonc on real workerd (PRD PAN-4482 WI-7).
 *
 * The test reads the `ROOM_CREATE_LIMIT` entry from `services/share/wrangler.jsonc`, so a change to the
 * committed limit fails here, then binds that entry in Miniflare through `startShareWorker`. One GitHub id
 * gets 10 rooms a minute; the 11th is 429 `rate_limited` with `Retry-After: 60`; another id is unaffected.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startShareWorker, tokenFor, type ShareTestUser, type ShareWorker } from '../../../helpers/share/share-worker.js';

const SERVICE_DIR = resolve(import.meta.dirname, '../../../../services/share');
const OWNER: ShareTestUser = { id: 1, login: 'owner' };
const VIEWER_A: ShareTestUser = { id: 100, login: 'alice' };

interface RateLimitEntry {
  readonly name: string;
  readonly namespace_id: string;
  readonly simple: { readonly limit: number; readonly period: 10 | 60 };
}

let entry: RateLimitEntry;
let worker: ShareWorker;

beforeAll(async () => {
  const config = parse(await readFile(join(SERVICE_DIR, 'wrangler.jsonc'), 'utf8')) as { ratelimits?: RateLimitEntry[] };
  const found = config.ratelimits?.find((r) => r.name === 'ROOM_CREATE_LIMIT');
  if (!found) throw new Error('services/share/wrangler.jsonc has no ROOM_CREATE_LIMIT ratelimits entry');
  entry = found;
  worker = await startShareWorker({
    users: [OWNER, VIEWER_A],
    rateLimit: { namespace: entry.namespace_id, limit: entry.simple.limit, period: entry.simple.period },
  });
}, 180_000);

afterAll(async () => {
  await worker?.dispose();
}, 60_000);

async function createRoom(user: ShareTestUser, conversationId: string): Promise<Response> {
  return (await worker.mf.dispatchFetch(`${worker.base}/v1/rooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor(user.id)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: { kind: 'conversation', conversationId } }),
  })) as unknown as Response;
}

describe('room-creation rate limit on real workerd (PAN-4482 WI-7)', () => {
  it('the committed limit is 10 rooms per 60 s per GitHub id', async () => {
    expect(entry.simple).toEqual({ limit: 10, period: 60 });

    for (let i = 0; i < 10; i += 1) {
      const res = await createRoom(OWNER, `c-${i}`);
      await res.text();
      expect(res.status, `room ${i + 1}`).toBe(201);
    }

    const refused = await createRoom(OWNER, 'c-10');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe('60');
    expect(await refused.json()).toEqual({ error: 'rate_limited' });

    const other = await createRoom(VIEWER_A, 'c-other');
    await other.text();
    expect(other.status).toBe(201);
  }, 180_000);
});

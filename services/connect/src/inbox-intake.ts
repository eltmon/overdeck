/**
 * `POST /h/:id`: the public webhook inbox URL (PRD PAN-2356 WI-8, D-2356-13, D-2356-14).
 *
 * The id is `<doId>.<secret>`: the account Durable Object's id (64 lowercase hex) and a 128-bit
 * secret (32 lowercase hex). There is no global index; the Worker rebuilds the object id from the
 * URL and hands the Durable Object only the secret's SHA-256. A malformed id, an id that is not a
 * Durable Object id and a wrong secret all answer the same 404.
 */
import { INBOX_BODY_MAX_BYTES } from '../../../packages/contracts/src/connect.ts';
import { HDR_INBOX_HEADERS, HDR_INBOX_SECRET_HASH, INTERNAL } from './env.ts';
import { json } from './http.ts';
import { KEPT_HEADERS, NOT_FOUND, sha256Hex } from './inbox.ts';
import type { Handler } from './routes.ts';

const INBOX_ID_RE = /^([0-9a-f]{64})\.([0-9a-f]{32})$/;

export type CappedBody = { ok: true; body: Uint8Array } | { ok: false };

/** Reads at most `max` bytes, counting as the stream arrives; Content-Length is not trusted. */
export async function readCapped(req: Request, max: number): Promise<CappedBody> {
  if (req.body === null) return { ok: true, body: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

export const inboxIntake: Handler = async (req, rc) => {
  const match = INBOX_ID_RE.exec(rc.params['id'] ?? '');
  if (!match) return json(NOT_FOUND, 404);
  const [, doId, secret] = match as unknown as [string, string, string];

  let id: DurableObjectId;
  try {
    id = rc.env.DIRECTORY.idFromString(doId);
  } catch {
    return json(NOT_FOUND, 404);
  }

  const secretHash = await sha256Hex(secret);
  if (rc.env.INBOX_LIMIT) {
    const { success } = await rc.env.INBOX_LIMIT.limit({ key: secretHash });
    if (!success) return json({ error: 'rate limited' }, 429, { 'Retry-After': '60' });
  }

  const read = await readCapped(req, INBOX_BODY_MAX_BYTES);
  if (!read.ok) return json({ error: 'event too large for the directory inbox' }, 413);

  const headers: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return rc.env.DIRECTORY.get(id).fetch('https://directory' + INTERNAL.inbox, {
    method: 'POST',
    headers: { [HDR_INBOX_SECRET_HASH]: secretHash, [HDR_INBOX_HEADERS]: JSON.stringify(headers) },
    body: read.body,
  });
};

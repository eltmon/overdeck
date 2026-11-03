/**
 * PAN-4843: the Overdeck app (native) push provider. For each paired phone it
 * seals the needs-you notification with `crypto_box_seal` to the phone's push
 * key and hands it to the overdeck.ai directory in a `push` frame; the
 * directory forwards it to APNs or FCM without seeing the content.
 *
 * The plaintext is capped at `PUSH_PLAINTEXT_MAX_BYTES` (2,256), not the epic's
 * 2,900: 2,256 bytes seal to exactly `PUSH_SEALED_MAX_CHARS` base64 characters
 * (D-1). Logs carry only a clientId prefix, never the sealed body, a push key
 * or notification text (NFR-1).
 */
import { createHash } from 'node:crypto';
import { PUSH_PLAINTEXT_MAX_BYTES, type PhonePushPayload } from '@overdeck/contracts';
import type { NeedsYouNotification } from './types.js';

const ELLIPSIS = '…';

/** The plaintext sealed for every phone (D-3). `title` is the full title: only the phone can read it. */
export function buildPhonePushPayload(n: NeedsYouNotification, machine: string): PhonePushPayload {
  return {
    v: 1,
    machine,
    kind: n.kind,
    title: n.title,
    body: n.body,
    url: n.url,
    tag: n.tag,
    issueId: n.issueId,
    ts: n.ts,
  };
}

function payloadBytes(p: PhonePushPayload): number {
  return Buffer.byteLength(JSON.stringify(p), 'utf8');
}

/** Largest `k` in `[0, codePoints.length - 1]` whose `cp(k) + '…'` fits, or null when none does. */
function largestFittingPrefix(codePoints: string[], fits: (text: string) => boolean): string | null {
  const text = (k: number) => codePoints.slice(0, k).join('') + ELLIPSIS;
  let lo = 0;
  let hi = codePoints.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(text(mid))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best === null ? null : text(best);
}

/**
 * The payload trimmed to at most `PUSH_PLAINTEXT_MAX_BYTES` of UTF-8 JSON by the D-4 rule:
 * trim `body`, then (with an empty body) `title`, on code-point boundaries. Null when even
 * `title: '…'` with an empty body does not fit. Only `title` and `body` ever change.
 */
export function fitPhonePushPayload(p: PhonePushPayload): PhonePushPayload | null {
  const fits = (candidate: PhonePushPayload) => payloadBytes(candidate) <= PUSH_PLAINTEXT_MAX_BYTES;
  if (fits(p)) return p;
  const body = largestFittingPrefix(Array.from(p.body), (text) => fits({ ...p, body: text }));
  if (body !== null) return { ...p, body };
  const emptied = { ...p, body: '' };
  const title = largestFittingPrefix(Array.from(p.title), (text) => fits({ ...emptied, title: text }));
  return title === null ? null : { ...emptied, title };
}

/** The `push` frame's `collapseId`: the first 32 hex characters of `sha256(tag)`. */
export function pushCollapseId(tag: string): string {
  return createHash('sha256').update(tag).digest('hex').slice(0, 32);
}

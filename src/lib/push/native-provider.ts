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
 *
 * PAN-5019 D-1: each phone's own preferences are checked here, per phone,
 * before sealing; a filtered phone is omitted from the outcomes rather than
 * recorded as `skipped`.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  notificationAllowed,
  PUSH_PLAINTEXT_MAX_BYTES,
  type DirectoryToMachineFrame,
  type MachineToDirectoryFrame,
  type PhoneNotificationPreferences,
  type PhonePushPayload,
  type PushResultError,
} from '@overdeck/contracts';
import { listActiveRecordsOfKind } from '../access-tokens.js';
import { sealTo } from '../anywhere/sealed-box.js';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { loadPhoneNotificationPreferences } from './phone-preferences-store.js';
import type { NeedsYouNotification, ProviderSendOutcome, PushProvider } from './types.js';
import { webPushUrgency } from './webpush-provider.js';

const ELLIPSIS = '…';

/** How long one phone's send waits for its `push-result` before it counts as `timeout` (D-5). */
export const NATIVE_PUSH_RESULT_TIMEOUT_MS = 10_000;

type PushResultFrame = Extract<DirectoryToMachineFrame, { type: 'push-result' }>;

/** The part of the directory client the native provider uses (structurally `DirectoryClient`). */
export interface PushDirectoryPort {
  isOnline(): boolean;
  send(frame: MachineToDirectoryFrame): boolean;
  on(type: 'push-result', handler: (frame: PushResultFrame) => void): () => void;
}

export interface NativePushProviderDeps {
  /** Resolved on every call: the directory client may start after the push service (PAN-4843 D-2). */
  directory: () => PushDirectoryPort | null;
  listPhones?: () => Array<{ clientId: string; pushKey: string }>;
  environmentId?: () => Promise<string>;
  randomRequestId?: () => string;
  /** A rejection is treated as an empty map (fail open, PAN-5019 NFR-1). */
  readPreferences?: () => Promise<ReadonlyMap<string, PhoneNotificationPreferences>>;
  now?: () => number;
}

type NativePhone = { clientId: string; pushKey: string };

/** Active phones that can receive a sealed push: the one list behind both sending and the Settings count (D-8). */
export function nativePushPhones(): NativePhone[] {
  return listActiveRecordsOfKind('phone').flatMap((record) =>
    record.clientId && record.pushKey ? [{ clientId: record.clientId, pushKey: record.pushKey }] : []);
}

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

/** `push-result` errors (D-5): a phone that turned notifications off or signed out is skipped, not failed. */
const PUSH_RESULT_REASONS: Record<PushResultError, 'skipped' | 'transient'> = {
  no_registration: 'skipped',
  unknown_client: 'skipped',
  rate_limited: 'transient',
  delivery_failed: 'transient',
};

/** Seals the notification to each paired phone and sends it through the overdeck.ai directory. */
export function createNativePushProvider(deps: NativePushProviderDeps): PushProvider {
  const listPhones = deps.listPhones ?? nativePushPhones;
  const environmentId = deps.environmentId ?? (async () => (await ensureEnvironmentIdentity()).environmentId);
  const randomRequestId = deps.randomRequestId ?? (() => randomBytes(16).toString('hex'));
  const readPreferences = deps.readPreferences ?? loadPhoneNotificationPreferences;
  const now = deps.now ?? Date.now;

  function sendOne(
    phone: NativePhone,
    plaintext: Buffer,
    frame: { urgency: 'high' | 'normal'; collapseId: string },
  ): Promise<ProviderSendOutcome> {
    const target = `native:${phone.clientId}`;
    const port = deps.directory();
    if (!port || !port.isOnline()) return Promise.resolve({ target, ok: false, reason: 'transient', detail: 'directory-offline' });
    let sealed: string;
    try {
      sealed = sealTo(Buffer.from(phone.pushKey, 'hex'), plaintext).toString('base64');
    } catch {
      return Promise.resolve({ target, ok: false, reason: 'transient', detail: 'seal-failed' });
    }
    const requestId = randomRequestId();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: () => void = () => {};
      let settled = false;
      const finish = (outcome: ProviderSendOutcome) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
        resolve(outcome);
      };
      unsubscribe = port.on('push-result', (result) => {
        if (result.requestId !== requestId) return;
        finish(result.ok
          ? { target, ok: true }
          : { target, ok: false, reason: PUSH_RESULT_REASONS[result.error], detail: result.error });
      });
      timer = setTimeout(() => finish({ target, ok: false, reason: 'transient', detail: 'timeout' }), NATIVE_PUSH_RESULT_TIMEOUT_MS);
      const accepted = port.send({ type: 'push', requestId, to: phone.clientId, sealed, ...frame });
      if (!accepted) finish({ target, ok: false, reason: 'transient', detail: 'directory-offline' });
    });
  }

  return {
    name: 'native',
    async hasTargets() {
      return listPhones().length > 0 && (deps.directory()?.isOnline() ?? false);
    },
    async send(n) {
      const all = listPhones();
      if (all.length === 0) return [];
      const prefs = await readPreferences().catch(() => new Map<string, PhoneNotificationPreferences>());
      const nowMs = now();
      const phones = all.filter((phone) => notificationAllowed(prefs.get(phone.clientId) ?? null, n.category, nowMs));
      if (phones.length === 0) return [];
      const payload = fitPhonePushPayload(buildPhonePushPayload(n, await environmentId()));
      if (!payload) {
        return phones.map((phone): ProviderSendOutcome => ({
          target: `native:${phone.clientId}`, ok: false, reason: 'rejected', detail: 'payload-too-large',
        }));
      }
      const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
      const frame = { urgency: webPushUrgency(n.kind), collapseId: pushCollapseId(n.tag) };
      const settled = await Promise.allSettled(phones.map((phone) => sendOne(phone, plaintext, frame)));
      const outcomes = settled.map((result, index): ProviderSendOutcome => (result.status === 'fulfilled'
        ? result.value
        : {
          target: `native:${phones[index]?.clientId ?? 'unknown'}`,
          ok: false,
          reason: 'transient',
          detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
      for (const outcome of outcomes) {
        if (!outcome.ok && outcome.reason !== 'skipped') {
          console.warn(`[push] native (${outcome.target.slice('native:'.length, 'native:'.length + 8)}…) ${outcome.detail ?? outcome.reason}`);
        }
      }
      return outcomes;
    },
  };
}

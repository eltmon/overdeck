/**
 * PAN-2354: the Web Push subscription store at
 * `<OVERDECK_HOME>/push/subscriptions.json`.
 *
 * A subscription endpoint plus its keys is a bearer push capability, so the
 * file is mode 0600 and written atomically (temp file, then rename) through one
 * in-process queue, like `access-tokens.ts`. Endpoints must point at a known
 * browser push service (D-14, the SSRF guard). Each record remembers the
 * credential that subscribed it, so revoking a paired device stops its push.
 * A corrupt file throws instead of being overwritten.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pushDir } from './vapid-keys.js';

export interface PushSubscriptionRecord {
  /** First 16 hex characters of sha256(endpoint). */
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label: string;
  /** Device id of the paired device that subscribed; null for the root session. */
  credentialId: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
}

export type EndpointValidation = { ok: true } | { ok: false; reason: 'endpoint-not-allowed' | 'endpoint-invalid' };

export type AddPushSubscriptionResult =
  | { ok: true; record: PushSubscriptionRecord }
  | { ok: false; reason: 'endpoint-not-allowed' | 'endpoint-invalid' | 'keys-invalid' | 'subscription-limit' };

const SUBSCRIPTIONS_FILENAME = 'subscriptions.json';
const MAX_SUBSCRIPTIONS = 20;
const MAX_LABEL_LENGTH = 60;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Browser push services an endpoint may point at (D-14). */
const ALLOWED_PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
const ALLOWED_PUSH_HOST_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

interface StoreFile {
  v: 1;
  subscriptions: PushSubscriptionRecord[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

export function subscriptionsPath(): string {
  return join(pushDir(), SUBSCRIPTIONS_FILENAME);
}

/**
 * Accept only `https:` endpoints on a known push service, with no credentials
 * and no port other than 443. `extraHosts` exists for tests only.
 */
export function validatePushEndpoint(url: string, extraHosts: readonly string[] = []): EndpointValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'endpoint-invalid' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'endpoint-not-allowed' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'endpoint-not-allowed' };
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, reason: 'endpoint-not-allowed' };
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_PUSH_HOSTS.includes(host)
    || extraHosts.includes(host)
    || ALLOWED_PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
  return allowed ? { ok: true } : { ok: false, reason: 'endpoint-not-allowed' };
}

function decodedLength(value: unknown): number {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return -1;
  return Buffer.from(value, 'base64url').length;
}

function keysValid(keys: { p256dh: string; auth: string }): boolean {
  if (decodedLength(keys.p256dh) !== 65) return false;
  if (Buffer.from(keys.p256dh, 'base64url')[0] !== 0x04) return false;
  return decodedLength(keys.auth) === 16;
}

function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

async function readStore(): Promise<PushSubscriptionRecord[]> {
  const path = subscriptionsPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Push subscription file ${path} is not valid JSON; it is never replaced automatically`);
  }
  const subscriptions = (parsed as Partial<StoreFile> | null)?.subscriptions;
  if (!Array.isArray(subscriptions)) {
    throw new Error(`Push subscription file ${path} has no subscriptions array; it is never replaced automatically`);
  }
  return subscriptions;
}

async function writeStore(records: PushSubscriptionRecord[]): Promise<void> {
  const dir = pushDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `${SUBSCRIPTIONS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: StoreFile = { v: 1, subscriptions: records };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, subscriptionsPath());
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Serialize every read-modify-write through one queue. */
function mutate<T>(
  change: (records: PushSubscriptionRecord[]) => { records: PushSubscriptionRecord[] | null; result: T },
): Promise<T> {
  const run = writeQueue.then(async () => {
    const { records, result } = change(await readStore());
    if (records !== null) await writeStore(records);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  await writeQueue;
  return readStore();
}

export function addPushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string | null;
  credentialId: string | null;
}): Promise<AddPushSubscriptionResult> {
  const endpointCheck = validatePushEndpoint(input.endpoint);
  if (!endpointCheck.ok) return Promise.resolve(endpointCheck);
  if (!input.keys || !keysValid(input.keys)) return Promise.resolve({ ok: false, reason: 'keys-invalid' });
  const label = (typeof input.label === 'string' ? input.label.trim() : '').slice(0, MAX_LABEL_LENGTH) || 'Phone';
  const id = subscriptionId(input.endpoint);

  return mutate<AddPushSubscriptionResult>((records) => {
    const existing = records.find(record => record.id === id);
    if (existing) {
      const updated: PushSubscriptionRecord = {
        ...existing,
        endpoint: input.endpoint,
        keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
        label,
        credentialId: input.credentialId,
      };
      return { records: records.map(record => (record.id === id ? updated : record)), result: { ok: true, record: updated } };
    }
    if (records.length >= MAX_SUBSCRIPTIONS) {
      return { records: null, result: { ok: false, reason: 'subscription-limit' } };
    }
    const record: PushSubscriptionRecord = {
      id,
      endpoint: input.endpoint,
      keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
      label,
      credentialId: input.credentialId,
      createdAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastFailureAt: null,
      failureCount: 0,
    };
    return { records: [...records, record], result: { ok: true, record } };
  });
}

export function removePushSubscription(id: string): Promise<boolean> {
  return mutate((records) => {
    if (!records.some(record => record.id === id)) return { records: null, result: false };
    return { records: records.filter(record => record.id !== id), result: true };
  });
}

/** Record a delivery outcome. A success clears the failure count. */
export function recordPushDelivery(id: string, outcome: 'success' | 'failure'): Promise<void> {
  return mutate((records) => {
    if (!records.some(record => record.id === id)) return { records: null, result: undefined };
    const now = new Date().toISOString();
    return {
      records: records.map((record) => {
        if (record.id !== id) return record;
        return outcome === 'success'
          ? { ...record, lastSuccessAt: now, failureCount: 0 }
          : { ...record, lastFailureAt: now, failureCount: record.failureCount + 1 };
      }),
      result: undefined,
    };
  });
}

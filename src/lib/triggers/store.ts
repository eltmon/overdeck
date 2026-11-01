/**
 * Trigger store (PAN-4648 W-1).
 *
 * The single read/write door for `${OVERDECK_HOME}/triggers.json`. A trigger is
 * a secret URL (`/hooks/<id>/<urlSecret>`) whose events either message one
 * existing conversation or start a new conversation in a project.
 *
 * The URL secret is 64 lowercase hex characters, returned once by
 * `createTrigger`; only its SHA-256 hex digest is stored. The optional signing
 * secret (GitHub or Stripe HMAC key) is stored in plain text because the
 * machine must compute the HMAC; nothing prints it after creation.
 *
 * The file is written atomically (temp file in the same directory, then
 * rename) with mode 0600, in a 0700 directory, and read-modify-write cycles are
 * serialized within this process. Reads always go to disk: events are rare, so
 * the CLI and the dashboard never disagree and no cache needs invalidating. A
 * file that does not parse throws naming the path, never a permissive parse.
 *
 * This module imports only Node built-ins, `../paths.js` and `./envelope.js` so
 * the CLI can load it without the dashboard or Effect runtime layers.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import { TRIGGER_TEMPLATE_MAX_CHARS } from './envelope.js';

export const TRIGGERS_FILENAME = 'triggers.json';
export const TRIGGER_ID_PREFIX = 'trg_';
const NAME_PATTERN = /^[A-Za-z0-9 ._-]{1,64}$/;
const SIGNING_SECRET_PATTERN = /^\S{8,256}$/;

export type TriggerTarget =
  | { kind: 'conversation'; conversation: string }
  | { kind: 'project'; projectKey: string; model?: string; harness?: string; effort?: string };

export type TriggerVerifyKind = 'none' | 'github' | 'stripe';

export interface TriggerRecord {
  id: string;
  name: string;
  secretHash: string;
  target: TriggerTarget;
  template: string | null;
  verify: TriggerVerifyKind;
  signingSecret: string | null;
  createdAt: string;
  /**
   * The overdeck.ai directory inbox that holds this trigger's events while the machine is offline
   * (PAN-2356). Absent on triggers written before it existed.
   */
  inbox?: TriggerInbox | null;
}

export interface TriggerInbox {
  /** `ib_` + 16 hex: the directory's public handle; the inbox secret lives only in the URL. */
  id: string;
  createdAt: string;
}

export type PublicTrigger = Omit<TriggerRecord, 'secretHash' | 'signingSecret'> & { signingSecretSet: boolean };

export interface CreateTriggerInput {
  name: string;
  target: TriggerTarget;
  template?: string | null;
  verify?: TriggerVerifyKind;
  signingSecret?: string | null;
}

export interface CreatedTrigger {
  trigger: PublicTrigger;
  urlSecret: string;
  hookPath: string;
  generatedSigningSecret: string | null;
}

interface TriggerFile {
  v: 1;
  triggers: TriggerRecord[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Absolute path of the store under the current OVERDECK_HOME. */
export function triggersPath(): string {
  return join(getOverdeckHome(), TRIGGERS_FILENAME);
}

/** SHA-256 hex digest of a URL secret, the only form the store keeps. */
export function hashUrlSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function toPublicTrigger(record: TriggerRecord): PublicTrigger {
  const { secretHash: _hash, signingSecret, ...rest } = record;
  return { ...rest, target: { ...rest.target }, signingSecretSet: signingSecret !== null };
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isTarget(value: unknown): value is TriggerTarget {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  if (t.kind === 'conversation') return typeof t.conversation === 'string';
  if (t.kind === 'project') {
    return typeof t.projectKey === 'string' && isOptionalString(t.model) && isOptionalString(t.harness) && isOptionalString(t.effort);
  }
  return false;
}

function isInbox(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const inbox = value as Record<string, unknown>;
  return typeof inbox.id === 'string' && /^ib_[0-9a-f]{16}$/.test(inbox.id) && typeof inbox.createdAt === 'string';
}

function isRecord(value: unknown): value is TriggerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.secretHash === 'string' &&
    /^[0-9a-f]{64}$/.test(r.secretHash) &&
    isTarget(r.target) &&
    (r.template === null || typeof r.template === 'string') &&
    (r.verify === 'none' || r.verify === 'github' || r.verify === 'stripe') &&
    (r.signingSecret === null || typeof r.signingSecret === 'string') &&
    typeof r.createdAt === 'string' &&
    isInbox(r.inbox)
  );
}

/** Read the file fresh. Absent → empty; unreadable or corrupt → throws naming the path. */
async function readStore(path: string): Promise<TriggerRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read trigger store ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot read trigger store ${path}: ${(error as Error).message}`);
  }
  const file = parsed as Partial<TriggerFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.triggers) || !file.triggers.every(isRecord)) {
    throw new Error(`Cannot read trigger store ${path}: unexpected shape`);
  }
  return file.triggers;
}

async function writeStore(path: string, records: TriggerRecord[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${TRIGGERS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: TriggerFile = { v: 1, triggers: records };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Serialize read-modify-write cycles within this process. */
function mutate<T>(change: (records: TriggerRecord[]) => { records: TriggerRecord[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = triggersPath();
    const { records, result } = change(await readStore(path));
    await writeStore(path, records);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function validateSigningSecret(secret: string): void {
  if (!SIGNING_SECRET_PATTERN.test(secret)) {
    throw new Error('Signing secret must be 8-256 characters with no whitespace');
  }
}

function normalizeTarget(target: TriggerTarget): TriggerTarget {
  if (target?.kind === 'conversation') {
    const conversation = typeof target.conversation === 'string' ? target.conversation.trim() : '';
    if (!conversation) throw new Error('Conversation target needs a conversation name');
    return { kind: 'conversation', conversation };
  }
  if (target?.kind === 'project') {
    const projectKey = typeof target.projectKey === 'string' ? target.projectKey.trim() : '';
    if (!projectKey) throw new Error('Project target needs a project key');
    const normalized: Extract<TriggerTarget, { kind: 'project' }> = { kind: 'project', projectKey };
    for (const field of ['model', 'harness', 'effort'] as const) {
      const value = target[field];
      if (value !== undefined && typeof value !== 'string') throw new Error(`Project target ${field} must be a string`);
      if (value?.trim()) normalized[field] = value.trim();
    }
    return normalized;
  }
  throw new Error("Trigger target kind must be 'conversation' or 'project'");
}

export async function createTrigger(input: CreateTriggerInput): Promise<CreatedTrigger> {
  if (typeof input.name !== 'string' || !NAME_PATTERN.test(input.name)) {
    throw new Error('Trigger name must be 1-64 characters from letters, digits, space, ".", "_" and "-"');
  }
  const target = normalizeTarget(input.target);
  const template = input.template === undefined || input.template === null || input.template === '' ? null : input.template;
  if (template !== null && typeof template !== 'string') throw new Error('Prompt template must be text');
  if (template !== null && template.length > TRIGGER_TEMPLATE_MAX_CHARS) {
    throw new Error(`Prompt template must be at most ${TRIGGER_TEMPLATE_MAX_CHARS} characters`);
  }
  if (target.kind === 'project' && (template === null || template.trim() === '')) {
    throw new Error('A project target needs a prompt template');
  }
  const verify = input.verify ?? 'none';
  if (verify !== 'none' && verify !== 'github' && verify !== 'stripe') {
    throw new Error("Verification must be 'none', 'github' or 'stripe'");
  }
  let signingSecret = input.signingSecret === undefined || input.signingSecret === '' ? null : input.signingSecret;
  if (signingSecret !== null) validateSigningSecret(signingSecret);
  let generatedSigningSecret: string | null = null;
  if (verify === 'github' && signingSecret === null) {
    generatedSigningSecret = randomBytes(32).toString('hex');
    signingSecret = generatedSigningSecret;
  }

  const urlSecret = randomBytes(32).toString('hex');
  const record: TriggerRecord = {
    id: `${TRIGGER_ID_PREFIX}${randomBytes(6).toString('hex')}`,
    name: input.name,
    secretHash: hashUrlSecret(urlSecret),
    target,
    template,
    verify,
    signingSecret,
    createdAt: new Date().toISOString(),
  };
  await mutate((records) => ({ records: [...records, record], result: undefined }));
  return {
    trigger: toPublicTrigger(record),
    urlSecret,
    hookPath: `/hooks/${record.id}/${urlSecret}`,
    generatedSigningSecret,
  };
}

export function listTriggers(): Promise<TriggerRecord[]> {
  return readStore(triggersPath());
}

export async function listPublicTriggers(): Promise<PublicTrigger[]> {
  return (await listTriggers()).map(toPublicTrigger);
}

/** Remove one trigger. Returns false when no record has that id. */
export function removeTrigger(id: string): Promise<boolean> {
  return mutate((records) => {
    const kept = records.filter((record) => record.id !== id);
    return { records: kept, result: kept.length !== records.length };
  });
}

/** Attach (or clear) a trigger's directory inbox. Returns null when no record has that id. */
export function setTriggerInbox(id: string, inbox: TriggerInbox | null): Promise<PublicTrigger | null> {
  return mutate((records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return { records, result: null };
    const updated: TriggerRecord = { ...records[index]!, inbox };
    const next = [...records];
    next[index] = updated;
    return { records: next, result: toPublicTrigger(updated) };
  });
}

/** Replace a trigger's signing secret. Returns null when no record has that id. */
export function setTriggerSigningSecret(id: string, secret: string): Promise<PublicTrigger | null> {
  if (typeof secret !== 'string') return Promise.reject(new Error('Signing secret must be text'));
  try {
    validateSigningSecret(secret);
  } catch (error) {
    return Promise.reject(error);
  }
  return mutate((records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return { records, result: null };
    const updated: TriggerRecord = { ...records[index], signingSecret: secret };
    const next = [...records];
    next[index] = updated;
    return { records: next, result: toPublicTrigger(updated) };
  });
}

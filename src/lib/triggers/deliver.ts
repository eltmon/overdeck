/**
 * Trigger delivery core (PAN-4648 W-4).
 *
 * `deliverTriggerEvent` takes one webhook request for `/hooks/<id>/<secret>`
 * and either sends one message to a conversation or starts one conversation in
 * a project. Steps run in order and the first refusal ends the run:
 *
 * 1. URL secret: SHA-256 of the presented secret against the stored hash with
 *    `timingSafeEqual`. An unknown id and a wrong secret give the same 404.
 * 2. Signature (`github` / `stripe`) over the raw bytes; no signing secret → 503.
 * 3. Rate limit: 6 starts (project) or 60 messages (conversation) per rolling
 *    hour, in memory, reset on restart. Only events that reach step 6 count.
 * 4. CPU hold: `saturated` → 503. Nothing is queued; the sender retries.
 * 5. Envelope (envelope.ts).
 * 6. Conversation target: refuse while the conversation has pending input, so a
 *    trigger can never answer a question or approve a permission; then the
 *    message door. Project target: the create door, passing model, harness and
 *    effort only when the record sets them.
 *
 * Logs name the trigger id and outcome only — never the body or any secret.
 * Server functions arrive through `TriggerDeliveryDeps`, because `src/lib`
 * never imports dashboard server code.
 */
import { timingSafeEqual } from 'node:crypto';
import { buildTriggerEnvelope, type TriggerEnvelopeSource } from './envelope.js';
import { verifyGitHubSignature, verifyStripeSignature } from './signatures.js';
import { hashUrlSecret, type TriggerRecord } from './store.js';

export const TRIGGER_RATE_WINDOW_MS = 3_600_000;
export const TRIGGER_PROJECT_STARTS_PER_HOUR = 6;
export const TRIGGER_CONVERSATION_MESSAGES_PER_HOUR = 60;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 3_600;
const HOLD_RETRY_AFTER_SECONDS = 300;

export interface TriggerEventInput {
  triggerId: string;
  urlSecret: string;
  headers: Record<string, string | string[] | undefined>; // lower-case names
  rawBody: Buffer;
}

export interface TriggerDeliveryDeps {
  readTriggers(): Promise<TriggerRecord[]>;
  now(): number;
  cpuPressure(): Promise<{ saturated: boolean }>;
  /** null = conversation not found. */
  pendingInputKinds(conversationName: string): Promise<string[] | null>;
  sendMessage(conversationName: string, message: string): Promise<{ status: number; body: unknown }>;
  startConversation(body: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
  log?(line: string): void;
}

export interface TriggerDeliveryResult {
  status: number;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

const acceptedDeliveries = new Map<string, number[]>();

export function _resetTriggerRateLimitsForTests(): void {
  acceptedDeliveries.clear();
}

function header(headers: TriggerEventInput['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function secretMatches(record: TriggerRecord, urlSecret: string): boolean {
  const presented = Buffer.from(hashUrlSecret(urlSecret));
  const stored = Buffer.from(record.secretHash);
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

function parseJsonObject(rawBody: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function eventLabels(source: TriggerEnvelopeSource, input: TriggerEventInput): { eventType: string | null; deliveryId: string | null } {
  if (source === 'stripe') {
    const body = parseJsonObject(input.rawBody);
    return {
      eventType: typeof body?.type === 'string' ? body.type : null,
      deliveryId: typeof body?.id === 'string' ? body.id : null,
    };
  }
  return {
    eventType: header(input.headers, 'x-github-event') ?? null,
    deliveryId: header(input.headers, 'x-github-delivery') ?? null,
  };
}

function doorError(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : null;
}

function held(reason: string): TriggerDeliveryResult {
  return { status: 503, body: { error: reason }, retryAfterSeconds: HOLD_RETRY_AFTER_SECONDS };
}

const TARGET_GONE: TriggerDeliveryResult = { status: 410, body: { error: 'target gone' } };

export async function deliverTriggerEvent(input: TriggerEventInput, deps: TriggerDeliveryDeps): Promise<TriggerDeliveryResult> {
  const result = await runDelivery(input, deps);
  const outcome = typeof result.body.error === 'string' ? result.body.error : result.body.started ? 'started' : 'delivered';
  (deps.log ?? console.log)(`[triggers] ${input.triggerId} ${outcome} ${result.status}`);
  return result;
}

async function runDelivery(input: TriggerEventInput, deps: TriggerDeliveryDeps): Promise<TriggerDeliveryResult> {
  // Step 1: URL secret. Unknown id and wrong secret must look the same.
  const record = (await deps.readTriggers()).find((candidate) => candidate.id === input.triggerId);
  if (!record || !secretMatches(record, input.urlSecret)) return { status: 404, body: { error: 'not found' } };

  // Step 2: signature over the exact raw bytes.
  let source: TriggerEnvelopeSource = 'unsigned';
  if (record.verify === 'github' || record.verify === 'stripe') {
    if (!record.signingSecret) return { status: 503, body: { error: 'signing secret not set' } };
    const check =
      record.verify === 'github'
        ? verifyGitHubSignature(input.rawBody, header(input.headers, 'x-hub-signature-256'), record.signingSecret)
        : verifyStripeSignature(input.rawBody, header(input.headers, 'stripe-signature'), record.signingSecret, Math.floor(deps.now() / 1000));
    if (!check.ok) return { status: 401, body: { error: 'invalid signature' } };
    source = record.verify;
  }

  // Step 3: rolling one-hour rate limit.
  const now = deps.now();
  const recent = (acceptedDeliveries.get(record.id) ?? []).filter((at) => now - at < TRIGGER_RATE_WINDOW_MS);
  acceptedDeliveries.set(record.id, recent);
  const limit = record.target.kind === 'project' ? TRIGGER_PROJECT_STARTS_PER_HOUR : TRIGGER_CONVERSATION_MESSAGES_PER_HOUR;
  if (recent.length >= limit) return { status: 429, body: { error: 'rate limit' }, retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS };

  // Step 4: CPU hold.
  if ((await deps.cpuPressure()).saturated) return held('host is CPU-saturated');

  // Step 5: envelope.
  const message = buildTriggerEnvelope({
    trigger: { id: record.id, name: record.name, template: record.template },
    source,
    ...eventLabels(source, input),
    rawBody: input.rawBody,
  });

  // Step 6: deliver. Reaching here consumes rate-limit budget.
  recent.push(now);
  const target = record.target;
  if (target.kind === 'conversation') {
    const pending = await deps.pendingInputKinds(target.conversation);
    if (pending === null) return TARGET_GONE;
    if (pending.length > 0) return held('conversation is waiting for an operator answer');
    const sent = await deps.sendMessage(target.conversation, message);
    if (sent.status >= 200 && sent.status < 300) return { status: 202, body: { delivered: true, conversation: target.conversation } };
    if (sent.status === 404 || sent.status === 422) return TARGET_GONE;
    return held(doorError(sent.body) ?? 'message delivery failed');
  }

  const createBody: Record<string, unknown> = { message, projectKey: target.projectKey };
  if (target.model) createBody.model = target.model;
  if (target.harness) createBody.harness = target.harness;
  if (target.effort) createBody.effort = target.effort;
  const started = await deps.startConversation(createBody);
  if (started.status === 201) {
    const row = started.body as { name?: unknown; id?: unknown };
    return { status: 202, body: { started: true, conversation: row.name, id: row.id } };
  }
  const error = doorError(started.body);
  if (started.status === 400 && error && /project/i.test(error)) return TARGET_GONE;
  return held(error ?? 'conversation start failed');
}

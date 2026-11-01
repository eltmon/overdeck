/**
 * PAN-2354: the `push:` block in config.yaml — needs-you notifications sent to
 * phones by Web Push (primary) and, optionally, an ntfy topic (titles only).
 *
 * Normalization never throws: the dashboard must boot with a bad block. Invalid
 * `events` entries are dropped, and a bad ntfy url or topic makes ntfy
 * `misconfigured` with a reason that `GET /api/push/status` shows.
 */

export type PushEventKind = 'question' | 'approval' | 'finished' | 'failed';

export const PUSH_EVENT_KINDS: readonly PushEventKind[] = ['question', 'approval', 'finished', 'failed'];

/** Raw `push:` block as it appears in config.yaml. Every field is optional. */
export interface PushYamlConfig {
  enabled?: boolean;
  events?: string[];
  includePreview?: boolean;
  webpush?: {
    /** VAPID subject. Apple requires an `https:` or `mailto:` URL. */
    subject?: string;
  };
  ntfy?: {
    url?: string;
    topic?: string;
    token?: string;
    clickBaseUrl?: string;
  };
}

export type NormalizedNtfyConfig =
  | { state: 'off' }
  | { state: 'misconfigured'; reason: string }
  | { state: 'ready'; url: string; topic: string; token: string | null; clickBaseUrl: string | null };

export interface NormalizedPushConfig {
  enabled: boolean;
  events: PushEventKind[];
  includePreview: boolean;
  webpush: { subject: string };
  ntfy: NormalizedNtfyConfig;
}

const DEFAULT_WEBPUSH_SUBJECT = 'https://overdeck.ai';
const NTFY_TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function defaultPushConfig(): NormalizedPushConfig {
  return {
    enabled: true,
    events: [...PUSH_EVENT_KINDS],
    includePreview: false,
    webpush: { subject: DEFAULT_WEBPUSH_SUBJECT },
    ntfy: { state: 'off' },
  };
}

function isPushEventKind(value: unknown): value is PushEventKind {
  return typeof value === 'string' && (PUSH_EVENT_KINDS as readonly string[]).includes(value);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeNtfy(raw: unknown): NormalizedNtfyConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'off' };
  const ntfy = raw as Record<string, unknown>;
  const url = nonEmptyString(ntfy['url']);
  const topic = nonEmptyString(ntfy['topic']);
  if (url === null && topic === null) return { state: 'off' };
  if (url === null) return { state: 'misconfigured', reason: 'url missing' };
  if (topic === null) return { state: 'misconfigured', reason: 'topic missing' };
  if (!isHttpUrl(url)) return { state: 'misconfigured', reason: 'url must be http or https' };
  if (!NTFY_TOPIC_PATTERN.test(topic)) {
    return { state: 'misconfigured', reason: 'topic must match ^[A-Za-z0-9_-]{1,64}$' };
  }
  const clickBaseUrl = nonEmptyString(ntfy['clickBaseUrl']);
  return {
    state: 'ready',
    url,
    topic,
    token: nonEmptyString(ntfy['token']),
    clickBaseUrl: clickBaseUrl !== null && isHttpUrl(clickBaseUrl) ? clickBaseUrl.replace(/\/+$/, '') : null,
  };
}

/**
 * Fold one config layer's `push:` block onto the value merged so far. A layer's
 * `ntfy:` mapping replaces the earlier ntfy settings as a whole.
 */
export function mergePushConfig(result: NormalizedPushConfig, config: { push?: PushYamlConfig } | null): void {
  const raw: unknown = config?.push;
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return;
  const push = raw as Record<string, unknown>;

  if (typeof push['enabled'] === 'boolean') result.enabled = push['enabled'];
  if (typeof push['includePreview'] === 'boolean') result.includePreview = push['includePreview'];
  if (Array.isArray(push['events'])) {
    result.events = PUSH_EVENT_KINDS.filter(kind => (push['events'] as unknown[]).some(e => isPushEventKind(e) && e === kind));
  }

  const webpush = push['webpush'];
  if (webpush !== null && typeof webpush === 'object' && !Array.isArray(webpush)) {
    const subject = nonEmptyString((webpush as Record<string, unknown>)['subject']);
    if (subject !== null && /^(https:|mailto:)/.test(subject)) result.webpush = { subject };
  }

  if (push['ntfy'] !== undefined) result.ntfy = normalizeNtfy(push['ntfy']);
}

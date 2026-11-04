/**
 * PAN-2354: the optional ntfy provider. It publishes a title-only message —
 * the kind plus an issue id or "a conversation" (`publicTitle`) — because an
 * ntfy server is a third party that sees plaintext. It never sends the Web
 * Push title, the body or a preview (D-1, D-8). Same timeout and single retry
 * as Web Push (D-10).
 */
import { loadConfigSync } from '../config-yaml.js';
import type { NormalizedPushConfig } from '../config-yaml/push-config.js';
import type { NeedsYouKind, NeedsYouNotification, PushProvider } from './types.js';
import { postWithRetry } from './webpush-provider.js';

export interface NtfyProviderDeps {
  fetchImpl?: typeof fetch;
  readConfig?: () => NormalizedPushConfig;
}

function ntfyPriority(kind: NeedsYouKind): '4' | '3' {
  return kind === 'question' || kind === 'approval' || kind === 'failed' ? '4' : '3';
}

/** HTTP header values must be ASCII; ntfy decodes RFC 2047 encoded words. */
function headerValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function createNtfyProvider(deps: NtfyProviderDeps = {}): PushProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readConfig = deps.readConfig ?? (() => loadConfigSync().config.push);

  return {
    name: 'ntfy',

    async hasTargets() {
      return readConfig().ntfy.state === 'ready';
    },

    async send(n) {
      const ntfy = readConfig().ntfy;
      if (ntfy.state !== 'ready') return [];
      const target = `ntfy:${new URL(ntfy.url).hostname}`;
      const headers: Record<string, string> = {
        Title: headerValue(n.publicTitle),
        Priority: ntfyPriority(n.kind),
        Tags: n.kind,
      };
      if (ntfy.clickBaseUrl !== null) headers['Click'] = `${ntfy.clickBaseUrl}${n.url}`;
      if (ntfy.token !== null) headers['Authorization'] = `Bearer ${ntfy.token}`;

      const attempt = await postWithRetry(fetchImpl, `${ntfy.url.replace(/\/$/, '')}/${encodeURIComponent(ntfy.topic)}`, {
        method: 'POST',
        headers,
        body: n.publicTitle,
      });
      if ('error' in attempt) {
        console.warn(`[push] ntfy (${target}) failed twice: ${attempt.error}`);
        return [{ target, ok: false, reason: 'transient', detail: attempt.error }];
      }
      const { status } = attempt;
      if (status >= 200 && status < 300) return [{ target, ok: true }];
      console.warn(`[push] ntfy (${target}) answered ${status}`);
      const transient = status === 429 || status >= 500;
      return [{ target, ok: false, reason: transient ? 'transient' : 'rejected', status }];
    },
  };
}

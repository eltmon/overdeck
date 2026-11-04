/**
 * Trigger setup helpers shared by `pan triggers` and `/api/triggers`
 * (PAN-4648 D-2, D-9, D-13).
 *
 * - The Funnel command: Tailscale Funnel on port 8443, mounted at `/hooks`
 *   only, so a dashboard served by Tailscale Serve on 443 stays private.
 *   Overdeck prints this command; it never runs `tailscale` itself.
 * - The Funnel base URL: `https://<host>:8443` when a trusted origin's host
 *   ends in `.ts.net`, else null (callers show the placeholder).
 * - Target resolution: a conversation is accepted by name or numeric id and
 *   stored by name; a project key must be registered.
 */
import { getConversationById, getConversationByName } from '../overdeck/conversations.js';
import { getProjectSync } from '../projects.js';
import type { TriggerTarget } from './store.js';

export const TRIGGER_FUNNEL_PORT = 8443;
export const TRIGGER_FUNNEL_PLACEHOLDER_BASE = `https://<machine>.<tailnet>.ts.net:${TRIGGER_FUNNEL_PORT}`;

/** The dashboard API port, resolved the way the server resolves it. */
export function triggerDashboardPort(): number {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return Number.isNaN(port) ? 3011 : port;
}

export function triggerFunnelCommand(port = triggerDashboardPort()): string {
  return `tailscale funnel --bg --https=${TRIGGER_FUNNEL_PORT} --set-path=/hooks http://127.0.0.1:${port}/hooks`;
}

export function triggerFunnelOffCommand(): string {
  return `tailscale funnel --https=${TRIGGER_FUNNEL_PORT} --set-path=/hooks off`;
}

/** `https://<host>:8443` for the first trusted origin on a `.ts.net` host, else null. */
export function triggerFunnelBaseUrl(origins: readonly string[]): string | null {
  for (const origin of origins) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (host.endsWith('.ts.net')) return `https://${host}:${TRIGGER_FUNNEL_PORT}`;
    } catch {
      // Not a URL; skip it.
    }
  }
  return null;
}

export type ResolvedTriggerTarget = { ok: true; target: TriggerTarget } | { ok: false; error: string };

/** Check a target against this machine's conversations and projects; store conversations by name. */
export function resolveTriggerTarget(target: unknown): ResolvedTriggerTarget {
  const t = (typeof target === 'object' && target !== null ? target : {}) as Record<string, unknown>;
  if (t.kind === 'conversation') {
    const ref = typeof t.conversation === 'string' ? t.conversation.trim() : '';
    const conversation = getConversationByName(ref) ?? (/^\d+$/.test(ref) ? getConversationById(Number(ref)) : null);
    if (!ref || !conversation) return { ok: false, error: `No conversation named or numbered "${ref}".` };
    return { ok: true, target: { kind: 'conversation', conversation: conversation.name } };
  }
  if (t.kind === 'project') {
    const projectKey = typeof t.projectKey === 'string' ? t.projectKey.trim() : '';
    if (!projectKey || !getProjectSync(projectKey)) return { ok: false, error: `No registered project "${projectKey}".` };
    return { ok: true, target: { ...(t as TriggerTarget & { kind: 'project' }), kind: 'project', projectKey } };
  }
  return { ok: false, error: "Trigger target kind must be 'conversation' or 'project'." };
}

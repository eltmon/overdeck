/**
 * POST /webhooks/creem (PRD PAN-4294 WI-4, FR-4, D-9, NFR-2).
 *
 * No rate-limit bucket (Creem retries on its own schedule) and a 64 KiB body limit set on the route.
 * Status codes: 503 billing_not_configured, 401 invalid_signature, 400 invalid_event, 200 duplicate,
 * then whatever applyEvent answers (200, or 503 unknown_subscription so Creem retries).
 */
import type { Handler } from '../env.ts';
import { json } from '../http.ts';
import { parseBillingConfig } from './catalog.ts';
import { verifySignature } from './creem.ts';
import { applyEvent, type CreemEnvelope } from './subscriptions.ts';

/** IC-3: Creem payloads are unmeasured. If Creem's delivery log shows 413, raise this. */
export const WEBHOOK_MAX_BODY_BYTES = 65_536;

function parseEnvelope(raw: Uint8Array): CreemEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const e = parsed as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id.startsWith('evt_')) return null;
  if (typeof e.eventType !== 'string' || e.eventType === '') return null;
  if (typeof e.created_at !== 'number' || !Number.isFinite(e.created_at)) return null;
  if (typeof e.object !== 'object' || e.object === null || Array.isArray(e.object)) return null;
  return { id: e.id, eventType: e.eventType, created_at: e.created_at, object: e.object as Record<string, unknown> };
}

export const handle: Handler = async (req, rc) => {
  const cfg = parseBillingConfig(rc.env);
  if (cfg === null) return json({ error: 'billing_not_configured' }, 503);
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(cfg.webhookSecret, raw, req.headers.get('creem-signature')))) return json({ error: 'invalid_signature' }, 401);
  const envelope = parseEnvelope(raw);
  if (envelope === null) return json({ error: 'invalid_event' }, 400);
  const seen = await rc.env.DB.prepare('SELECT 1 AS seen FROM billing_events WHERE event_id = ?').bind(envelope.id).first<number>('seen');
  if (seen !== null) return json({ ok: true, duplicate: true });
  const result = await applyEvent(rc, cfg, envelope);
  return json(result.body, result.status);
};

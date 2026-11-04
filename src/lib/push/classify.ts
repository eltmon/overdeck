/**
 * PAN-2354: the pure classifier for needs-you push. It turns enrichment
 * payloads, conversation pending-input rows and edge events into pending items
 * and notifications. No I/O.
 *
 * Keys (D-4): `auq:<toolUseId>`, `plan:<toolUseId>`, `perm:<signature>`
 * (`perm:pending` when there is no signature). The closed trigger list is D-5;
 * everything else returns no item. Titles and bodies follow D-8: the Web Push
 * title may name the conversation, the public (ntfy) title never does, and the
 * default body never carries question text. URLs follow D-7 and are always
 * same-origin paths.
 */
import type { NeedsYouNotification } from './types.js';

export interface PendingItem {
  subject: string;
  key: string;
  kind: 'question' | 'approval';
  /** What a phone's notification-type switches act on (PAN-5019 D-2). */
  category: 'question' | 'plan' | 'permission';
  askedAt: string | null;
  issueId: string | null;
  label: string;
  url: string;
  preview: string | null;
}

export type EdgeNotification = Omit<NeedsYouNotification, 'ts'> & { kind: 'finished' | 'failed' };

interface AuqLike {
  toolUseId: string;
  askedAt?: string;
  questions?: ReadonlyArray<{ question?: string }>;
}

interface PlanLike {
  toolUseId: string;
  askedAt?: string;
  plan?: string;
}

export interface EnrichmentPayloadLike {
  agentId: string;
  issueId?: string | null;
  role?: string | null;
  pendingAskUserQuestion?: AuqLike | null;
  pendingProposedPlan?: PlanLike | null;
  pendingInputKinds?: readonly string[] | null;
}

export interface ConversationRowLike {
  name: string;
  title?: string | null;
  issueId?: string | null;
  pendingAskUserQuestion?: AuqLike | null;
  pendingProposedPlan?: PlanLike | null;
  pendingPermission?: { signature?: string | null; since?: string | null } | null;
}

const PREVIEW_MAX = 140;
const LABEL_MAX = 60;
const PHONE_SHELL_URL = '/m';

const KIND_WORD: Record<'question' | 'approval' | 'finished' | 'failed', string> = {
  question: 'Question',
  approval: 'Approval needed',
  finished: 'Finished',
  failed: 'Failed',
};

const DEFAULT_BODY: Record<'question' | 'approval', string> = {
  question: 'Tap to answer.',
  approval: 'Tap to review.',
};

/** `pipeline.journal` entry types that notify (D-5), with their kind and body. */
const JOURNAL_EDGES: Record<string, { kind: 'finished' | 'failed'; body: string }> = {
  'verification.started': { kind: 'finished', body: 'Work is done; verification started.' },
  'merge.completed': { kind: 'finished', body: 'Merged.' },
  'merge.failed': { kind: 'failed', body: 'Merge failed.' },
  'review.stall-escalated': { kind: 'failed', body: 'A review stalled and needs you.' },
  'conflict.repair-escalated': { kind: 'failed', body: 'A conflict repair needs you.' },
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function subjectUrl(subjectId: string): string {
  return `${PHONE_SHELL_URL}?subject=${encodeURIComponent(subjectId)}`;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function questionPreview(auq: AuqLike): string | null {
  return nonEmpty(auq.questions?.[0]?.question);
}

function planPreview(plan: PlanLike): string | null {
  const line = (plan.plan ?? '').split('\n').map(l => l.trim()).find(l => l !== '');
  return line ?? null;
}

export function pendingItemsFromEnrichment(payload: EnrichmentPayloadLike): { subject: string; items: PendingItem[] } {
  const subject = `agent:${payload.agentId}`;
  const issueId = nonEmpty(payload.issueId);
  const role = nonEmpty(payload.role);
  const label = issueId ? (role ? `${issueId} ${role}` : issueId) : payload.agentId;
  const base = { subject, issueId, label, url: subjectUrl(payload.agentId) };
  const items: PendingItem[] = [];

  const auq = payload.pendingAskUserQuestion;
  if (auq && nonEmpty(auq.toolUseId)) {
    items.push({ ...base, key: `auq:${auq.toolUseId}`, kind: 'question', category: 'question', askedAt: nonEmpty(auq.askedAt), preview: questionPreview(auq) });
  }
  const plan = payload.pendingProposedPlan;
  if (plan && nonEmpty(plan.toolUseId)) {
    items.push({ ...base, key: `plan:${plan.toolUseId}`, kind: 'approval', category: 'plan', askedAt: nonEmpty(plan.askedAt), preview: planPreview(plan) });
  }
  if (payload.pendingInputKinds?.includes('permissionRequest')) {
    items.push({ ...base, key: 'perm:pending', kind: 'approval', category: 'permission', askedAt: null, preview: null });
  }
  return { subject, items };
}

export function pendingItemsFromConversationRow(row: ConversationRowLike): { subject: string; items: PendingItem[] } {
  const subject = `conv:${row.name}`;
  const title = nonEmpty(row.title);
  const base = {
    subject,
    issueId: nonEmpty(row.issueId),
    label: title ? truncate(title, LABEL_MAX) : row.name,
    url: subjectUrl(row.name),
  };
  const items: PendingItem[] = [];

  const auq = row.pendingAskUserQuestion;
  if (auq && nonEmpty(auq.toolUseId)) {
    items.push({ ...base, key: `auq:${auq.toolUseId}`, kind: 'question', category: 'question', askedAt: nonEmpty(auq.askedAt), preview: questionPreview(auq) });
  }
  const plan = row.pendingProposedPlan;
  if (plan && nonEmpty(plan.toolUseId)) {
    items.push({ ...base, key: `plan:${plan.toolUseId}`, kind: 'approval', category: 'plan', askedAt: nonEmpty(plan.askedAt), preview: planPreview(plan) });
  }
  const permission = row.pendingPermission;
  if (permission) {
    items.push({
      ...base,
      key: `perm:${nonEmpty(permission.signature) ?? 'pending'}`,
      kind: 'approval',
      category: 'permission',
      askedAt: nonEmpty(permission.since),
      preview: null,
    });
  }
  return { subject, items };
}

function publicTitle(kind: keyof typeof KIND_WORD, issueId: string | null): string {
  return `${KIND_WORD[kind]} · ${issueId ?? 'a conversation'}`;
}

export function toNotification(item: PendingItem, opts: { includePreview: boolean; now: string }): NeedsYouNotification {
  const preview = opts.includePreview && item.preview ? truncate(item.preview, PREVIEW_MAX) : null;
  return {
    kind: item.kind,
    category: item.category,
    tag: item.key,
    title: `${KIND_WORD[item.kind]} · ${item.label}`,
    publicTitle: publicTitle(item.kind, item.issueId),
    body: preview ?? DEFAULT_BODY[item.kind],
    url: item.url,
    issueId: item.issueId,
    ts: opts.now,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function edgeNotificationFromEvent(event: { type: string; timestamp: string; payload: unknown }): EdgeNotification | null {
  const payload = record(event.payload);
  if (!payload) return null;

  if (event.type === 'agent.heartbeat_dead') {
    const agentId = nonEmpty(payload['agentId']);
    if (!agentId) return null;
    const issueId = nonEmpty(payload['issueId']);
    return {
      kind: 'failed',
      category: 'stopped',
      tag: `dead:${agentId}:${event.timestamp}`,
      title: `${KIND_WORD.failed} · ${issueId ?? agentId}`,
      publicTitle: publicTitle('failed', issueId),
      body: 'The agent stopped responding.',
      url: PHONE_SHELL_URL,
      issueId,
    };
  }

  if (event.type === 'pipeline.journal') {
    const entry = record(payload['entry']);
    const entryType = nonEmpty(entry?.['type']);
    const edge = entryType ? JOURNAL_EDGES[entryType] : undefined;
    if (!entry || !entryType || !edge) return null;
    const issueId = nonEmpty(payload['issueId']) ?? nonEmpty(entry['issueId']);
    if (!issueId) return null;
    const stamp = nonEmpty(entry['at']) ?? nonEmpty(record(entry['data'])?.['head']) ?? event.timestamp;
    return {
      kind: edge.kind,
      category: edge.kind,
      tag: `journal:${issueId}:${entryType}:${stamp}`,
      title: `${KIND_WORD[edge.kind]} · ${issueId}`,
      publicTitle: publicTitle(edge.kind, issueId),
      body: edge.body,
      url: PHONE_SHELL_URL,
      issueId,
    };
  }

  return null;
}

/**
 * The admin screen's billing view (PRD PAN-4294 WI-8, FR-12): a Billing cell per account, the founding count,
 * subscribers without an invite, failing cancels and webhook events no account matched. Shown only when billing
 * is configured. Every dynamic value passes through escapeHtml().
 */
import { formatDate, formatDateTime } from '../admin/screen.ts';
import type { RequestContext } from '../env.ts';
import { escapeHtml } from '../pages.ts';
import { billingStateFor, type BillingState, type SubscriptionRow } from './access.ts';
import { FOUNDING_LIMIT, PRODUCTS, type ProductKey } from './catalog.ts';

export const FAILING_CANCELS_HEADING = 'Subscription cancels failing';
export const FAILING_CANCELS_NOTE = 'Cancel these by hand in the Creem dashboard.';
export const UNMATCHED_HEADING = 'Webhook events not matched to an account';
export const UNMATCHED_NOTE = 'Creem retries these for 24 hours. Match them by hand if they stay.';
export const NO_INVITE_HEADING = 'Subscribers without an invite';

export function foundingSoldText(sold: number): string {
  return `Founding places sold: ${sold} of ${FOUNDING_LIMIT}`;
}

/** "Anywhere annual with the relay", "Founding annual", "Anywhere monthly". */
export function adminProductLabel(key: ProductKey): string {
  const p = PRODUCTS[key];
  return `${p.founding ? 'Founding' : 'Anywhere'} ${p.interval === 'month' ? 'monthly' : 'annual'}${p.relay ? ' with the relay' : ''}`;
}

export function billingCellText(state: BillingState | undefined): string {
  if (state === undefined) return '—';
  if (state.paid !== null) {
    if (state.pastDue) return 'Past due';
    return `${adminProductLabel(state.paid.productKey)}, paid through ${formatDate(state.paid.paidThrough)}`;
  }
  if (state.lapse !== null) return `Lapsed on ${formatDate(state.lapse.lapsedAt)}`;
  return '—';
}

interface SubscriberRow extends SubscriptionRow {
  github_id: number;
  github_login: string;
}

interface FailingCancelRow {
  subscription_id: string;
  user_id: string;
  github_login: string | null;
  cancel_attempts: number;
  cancel_error: string;
}

interface UnresolvedRow {
  event_id: string;
  event_type: string;
  subscription_id: string | null;
  first_seen_at: number;
  attempts: number;
}

export interface AdminBilling {
  /** Billing state per GitHub id, for every account with a subscription row. */
  byGithubId: Map<number, BillingState>;
  logins: Map<number, string>;
  foundingSold: number;
  failingCancels: FailingCancelRow[];
  unresolved: UnresolvedRow[];
}

export async function loadAdminBilling(rc: Pick<RequestContext, 'env' | 'deps'>): Promise<AdminBilling> {
  const db = rc.env.DB;
  const now = rc.deps.now();
  const subscribers = await db
    .prepare('SELECT s.*, u.github_id, u.github_login FROM subscriptions s JOIN users u ON u.user_id = s.user_id')
    .all<SubscriberRow>();
  const grouped = new Map<number, SubscriberRow[]>();
  const logins = new Map<number, string>();
  for (const row of subscribers.results) {
    grouped.set(row.github_id, [...(grouped.get(row.github_id) ?? []), row]);
    logins.set(row.github_id, row.github_login);
  }
  const byGithubId = new Map<number, BillingState>();
  for (const [githubId, rows] of grouped) byGithubId.set(githubId, billingStateFor(rows, now));
  const foundingSold = (await db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE founding = 1').first<number>('n')) ?? 0;
  const failingCancels = await db
    .prepare(
      `SELECT s.subscription_id, s.user_id, u.github_login, s.cancel_attempts, s.cancel_error
       FROM subscriptions s LEFT JOIN users u ON u.user_id = s.user_id
       WHERE s.cancel_error IS NOT NULL AND s.cancel_done_at IS NULL
       ORDER BY s.cancel_requested_at`,
    )
    .all<FailingCancelRow>();
  const unresolved = await db
    .prepare('SELECT event_id, event_type, subscription_id, first_seen_at, attempts FROM billing_unresolved ORDER BY first_seen_at')
    .all<UnresolvedRow>();
  return { byGithubId, logins, foundingSold, failingCancels: failingCancels.results, unresolved: unresolved.results };
}

/** The tables below the allowlist: subscribers without a grant row, failing cancels, unmatched webhook events. */
export function adminBillingSections(view: AdminBilling, grantedIds: ReadonlySet<number>): string {
  const parts: string[] = [];
  const noInvite = [...view.byGithubId.entries()].filter(([githubId]) => !grantedIds.has(githubId));
  if (noInvite.length > 0) {
    const rows = noInvite
      .map(
        ([githubId, state]) =>
          `<tr><td>${escapeHtml(view.logins.get(githubId) ?? '')}</td><td>${escapeHtml(githubId)}</td><td>${escapeHtml(billingCellText(state))}</td></tr>`,
      )
      .join('\n');
    parts.push(`<h2>${escapeHtml(NO_INVITE_HEADING)}</h2>
<table>
<thead><tr><th>Login</th><th>GitHub id</th><th>Billing</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`);
  }
  if (view.failingCancels.length > 0) {
    const rows = view.failingCancels
      .map(
        (c) =>
          `<tr><td>${escapeHtml(c.github_login ?? c.user_id)}</td><td>${escapeHtml(c.subscription_id)}</td><td>${escapeHtml(c.cancel_attempts)}</td><td>${escapeHtml(c.cancel_error)}</td></tr>`,
      )
      .join('\n');
    parts.push(`<h2>${escapeHtml(FAILING_CANCELS_HEADING)}</h2>
<p class="warn">${escapeHtml(FAILING_CANCELS_NOTE)}</p>
<table>
<thead><tr><th>Login</th><th>Subscription</th><th>Attempts</th><th>Error</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`);
  }
  if (view.unresolved.length > 0) {
    const rows = view.unresolved
      .map(
        (u) =>
          `<tr><td>${escapeHtml(u.event_id)}</td><td>${escapeHtml(u.event_type)}</td><td>${escapeHtml(u.subscription_id ?? '—')}</td><td>${escapeHtml(formatDateTime(u.first_seen_at))}</td><td>${escapeHtml(u.attempts)}</td></tr>`,
      )
      .join('\n');
    parts.push(`<h2>${escapeHtml(UNMATCHED_HEADING)}</h2>
<p class="muted">${escapeHtml(UNMATCHED_NOTE)}</p>
<table>
<thead><tr><th>Event</th><th>Type</th><th>Subscription</th><th>First seen</th><th>Attempts</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`);
  }
  return parts.join('\n');
}

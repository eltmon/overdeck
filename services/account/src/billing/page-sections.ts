/**
 * The account page's plan label and Billing section for every billing state (PRD PAN-4294 WI-6, FR-10, D-7, D-15).
 *
 * Server-rendered, no JavaScript; every dynamic value passes through escapeHtml(). Prices come from the catalog
 * and must match the Creem products; Creem's checkout shows the binding price (D-15).
 */
import { formatDate } from '../admin/screen.ts';
import type { Entitlement } from '../entitlement.ts';
import { escapeHtml } from '../pages.ts';
import type { BillingState } from './access.ts';
import { PRODUCTS } from './catalog.ts';

export const PLAN_LABEL_ANYWHERE_RELAY = 'Anywhere with the relay';
export const PLAN_LABEL_ANYWHERE = 'Anywhere';
export const PLAN_LABEL_FREE = 'Free account';
export const PLAN_LABEL_TESTER = 'Tester';
export const FOUNDING_LOCKED_MESSAGE = 'Founding price, locked while you stay subscribed.';
export const CHECKOUT_PENDING_MESSAGE = 'Payment received. Your plan changes as soon as Creem confirms it, usually within a minute.';
export const PAST_DUE_MESSAGE = 'Your last payment failed. Creem is retrying it; update your card in Manage billing.';
export const MONTHLY_OPTION = '$10 a month';
export const ANNUAL_OPTION = '$96 a year ($8 a month)';
export const FOUNDING_OPTION = '$60 a year, founding price';
export const RELAY_OPTION = 'Add the relay: +$3 a month or +$30 a year, 50 GB of relay traffic a month';
export const SUBSCRIBE_BUTTON = 'Subscribe';
export const ADD_RELAY_BUTTON = 'Add the relay';
export const REMOVE_RELAY_BUTTON = 'Remove the relay';
export const MANAGE_BILLING_BUTTON = 'Manage billing (card, invoices, cancel)';
export const RELAY_NOT_IN_PLAN_MESSAGE = 'The relay is not included in your plan.';

export function paidThroughText(paidThrough: number): string {
  return `Paid through ${formatDate(paidThrough)}`;
}

export function foundingPlacesText(placesLeft: number): string {
  return `${placesLeft} founding places left`;
}

export function lapsedGraceText(lapsedAt: number, graceEndsAt: number): string {
  return `Your Anywhere plan ended on ${formatDate(lapsedAt)}. Until ${formatDate(graceEndsAt)} your hosted data stays readable and subscribing again restores everything.`;
}

export function exportWindowText(deletesAt: number): string {
  return `Hosted vault data above the free 1 GB will be deleted on ${formatDate(deletesAt)}. Export it now with pan vault migrate, or subscribe again.`;
}

export function deletedText(deletesAt: number): string {
  return `Hosted vault data above the free 1 GB was deleted on ${formatDate(deletesAt)}.`;
}

export function planLabel(entitlement: Entitlement): string {
  if (entitlement.plan === 'anywhere') return entitlement.relay ? PLAN_LABEL_ANYWHERE_RELAY : PLAN_LABEL_ANYWHERE;
  return entitlement.plan === 'free' ? PLAN_LABEL_FREE : PLAN_LABEL_TESTER;
}

/** The plan section's lines under the label for a paying account: paid-through date and the founding note. */
export function paidPlanLines(billing: BillingState): string {
  if (billing.paid === null) return '';
  const founding = billing.paid.founding ? `\n<p class="muted">${escapeHtml(FOUNDING_LOCKED_MESSAGE)}</p>` : '';
  return `\n<p>${escapeHtml(paidThroughText(billing.paid.paidThrough))}</p>${founding}`;
}

function p(text: string, cls?: string): string {
  return `<p${cls ? ` class="${cls}"` : ''}>${escapeHtml(text)}</p>`;
}

function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

function buttonForm(action: string, csrf: string, label: string, fields: Record<string, string> = {}): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  return `<form method="post" action="${escapeHtml(action)}">${csrfField(csrf)}${hidden}<button type="submit">${escapeHtml(label)}</button></form>`;
}

function radio(value: string, label: string, checked: boolean): string {
  return `<label><input type="radio" name="plan" value="${escapeHtml(value)}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label><br>`;
}

export interface Founding {
  available: boolean;
  placesLeft: number;
}

function subscribeForm(csrf: string, founding: Founding): string {
  const foundingOption = founding.available
    ? `\n${radio('founding', FOUNDING_OPTION, false)}\n<span class="muted">${escapeHtml(foundingPlacesText(founding.placesLeft))}</span><br>`
    : '';
  return `<form method="post" action="/account/billing/checkout">
${csrfField(csrf)}
${radio('monthly', MONTHLY_OPTION, false)}
${radio('annual', ANNUAL_OPTION, true)}${foundingOption}
<label><input type="checkbox" name="relay" value="1"> ${escapeHtml(RELAY_OPTION)}</label><br>
<button type="submit">${escapeHtml(SUBSCRIBE_BUTTON)}</button>
</form>`;
}

function lapseLine(entitlement: Entitlement, now: number): string {
  const lapse = entitlement.lapse;
  if (lapse === null) return '';
  if (now < lapse.graceEndsAt) return p(lapsedGraceText(lapse.lapsedAt, lapse.graceEndsAt), 'warn');
  if (now < lapse.deletesAt) return p(exportWindowText(lapse.deletesAt), 'warn');
  return p(deletedText(lapse.deletesAt), 'muted');
}

export interface BillingSectionInput {
  entitlement: Entitlement;
  billing: BillingState;
  /** null when no founding check ran (paid access already). */
  founding: Founding | null;
  csrf: string;
  checkoutDone: boolean;
  now: number;
}

/** The Billing section when billing is configured (the unconfigured page keeps BILLING_MESSAGE). */
export function billingSection(input: BillingSectionInput): string {
  const { billing, csrf } = input;
  const lines: string[] = ['<h2>Billing</h2>'];
  if (billing.paid !== null) {
    const product = PRODUCTS[billing.paid.productKey];
    lines.push(p(`${product.label}, ${product.priceText}`));
    if (billing.pastDue) lines.push(p(PAST_DUE_MESSAGE, 'warn'));
    lines.push(
      product.relay
        ? buttonForm('/account/billing/relay', csrf, REMOVE_RELAY_BUTTON, { action: 'remove' })
        : buttonForm('/account/billing/relay', csrf, ADD_RELAY_BUTTON, { action: 'add' }),
    );
    lines.push(buttonForm('/account/billing/portal', csrf, MANAGE_BILLING_BUTTON));
    return lines.join('\n');
  }
  const lapse = lapseLine(input.entitlement, input.now);
  if (lapse !== '') lines.push(lapse);
  if (input.checkoutDone) lines.push(p(CHECKOUT_PENDING_MESSAGE));
  lines.push(subscribeForm(csrf, input.founding ?? { available: false, placesLeft: 0 }));
  // A former subscriber keeps the portal for invoices (FR-9).
  if (billing.hasLiveRow) lines.push(buttonForm('/account/billing/portal', csrf, MANAGE_BILLING_BUTTON));
  return lines.join('\n');
}

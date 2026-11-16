/**
 * Account-page billing actions (PRD PAN-4294 WI-5; FR-2, FR-3, FR-8, FR-9; D-10, D-12).
 *
 * Every handler requires the web session's csrf field and a same-site Origin (requireUserSession). The checkout
 * and portal answer an interstitial page with one link to Creem instead of a redirect: the page's CSP limits
 * form-action to 'self' and GitHub, and browsers apply form-action to redirects after a form post (D-12).
 */
import { renderAccountPage } from '../account-page/page.ts';
import { requireUserSession, type UserSession } from '../account-page/session.ts';
import type { Handler, RequestContext } from '../env.ts';
import { html, redirect } from '../http.ts';
import { escapeHtml, layout } from '../pages.ts';
import { billingStateFor, loadSubscriptions } from './access.ts';
import {
  CHECKOUT_RESERVATION_MS,
  chooseProduct,
  parseBillingConfig,
  PRODUCTS,
  relayPair,
  type BillingConfig,
} from './catalog.ts';
import { createCheckout, idOf, portalLink, upgradeSubscription } from './creem.ts';
import { FOUNDING_OPEN_SQL } from './founding.ts';

export { foundingAvailability } from './founding.ts';

export const BILLING_UNAVAILABLE_MESSAGE = 'Billing is not available yet.';
export const CHOOSE_PLAN_MESSAGE = 'Choose a plan.';
export const ALREADY_SUBSCRIBED_MESSAGE = 'You already have the Anywhere plan.';
export const FOUNDING_UNAVAILABLE_MESSAGE = 'The founding price is no longer available.';
export const CHECKOUT_FAILED_MESSAGE = 'Creem could not start the checkout. Try again in a minute.';
export const SUBSCRIPTION_ENDING_MESSAGE = 'Your subscription is ending; subscribe again to change the relay.';
export const UPGRADE_FAILED_MESSAGE = 'Creem could not change the subscription. Try again in a minute.';
export const NO_SUBSCRIPTION_MESSAGE = 'You have no subscription.';
export const PORTAL_FAILED_MESSAGE = 'Creem could not open billing. Try again in a minute.';
export const CHOOSE_RELAY_ACTION_MESSAGE = 'Choose whether to add or remove the relay.';
export const CHECKOUT_HEADING = 'Continue to payment';
export const CHECKOUT_LINK_TEXT = 'Continue to secure checkout on Creem';
export const CARD_NOTE = 'Overdeck never sees your card details.';
export const PORTAL_HEADING = 'Manage billing';
export const PORTAL_LINK_TEXT = 'Open billing on Creem';

const PLAN_CHOICES = {
  monthly: { interval: 'month', founding: false },
  annual: { interval: 'year', founding: false },
  founding: { interval: 'year', founding: true },
} as const;

/** The interstitial page (D-12): one link to an https Creem URL that createCheckout or portalLink already checked. */
function interstitial(heading: string, url: string, linkText: string, note: string | null): Response {
  const extra = note === null ? '' : `\n<p class="muted">${escapeHtml(note)}</p>`;
  return html(
    layout(
      heading,
      `<h1>${escapeHtml(heading)}</h1>
<p><a href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(linkText)}</a></p>${extra}
<p><a href="/account">Back to your account</a></p>`,
    ),
  );
}

type Prelude = { ok: true; session: UserSession; form: URLSearchParams; cfg: BillingConfig } | { ok: false; response: Response };

async function prelude(req: Request, rc: RequestContext): Promise<Prelude> {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user;
  const cfg = parseBillingConfig(rc.env);
  if (cfg === null) return { ok: false, response: await renderAccountPage(rc, user.session, { error: BILLING_UNAVAILABLE_MESSAGE, status: 503 }) };
  return { ok: true, session: user.session, form: user.form ?? new URLSearchParams(), cfg };
}

/** POST /account/billing/checkout — reserve a checkout row, then ask Creem for the checkout page (FR-2, FR-3, D-10). */
export const checkout: Handler = async (req, rc) => {
  const p = await prelude(req, rc);
  if (!p.ok) return p.response;
  const { session, form, cfg } = p;
  const planField = form.get('plan') ?? '';
  const relayField = form.get('relay') ?? '0';
  if (!Object.hasOwn(PLAN_CHOICES, planField) || (relayField !== '0' && relayField !== '1')) {
    return renderAccountPage(rc, session, { error: CHOOSE_PLAN_MESSAGE, status: 400 });
  }
  const choice = PLAN_CHOICES[planField as keyof typeof PLAN_CHOICES];
  const now = rc.deps.now();
  const billing = billingStateFor(await loadSubscriptions(rc, session.userId), now);
  if (billing.paid !== null) return renderAccountPage(rc, session, { error: ALREADY_SUBSCRIBED_MESSAGE, status: 409 });

  const productKey = chooseProduct({ interval: choice.interval, relay: relayField === '1', founding: choice.founding });
  const checkoutId = crypto.randomUUID();
  const expiresAt = now + CHECKOUT_RESERVATION_MS;
  const db = rc.env.DB;
  // Expire, never delete, the user's open checkouts: a late payment on an old Creem URL must still map (D-8).
  const expireOpen = db.prepare('UPDATE checkouts SET expires_at = ? WHERE user_id = ? AND completed_at IS NULL AND expires_at > ?').bind(now, session.userId, now);
  const reserve = choice.founding
    ? db
        .prepare(
          `INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at)
           SELECT ?, ?, ?, 1, ?, ?
           WHERE ${FOUNDING_OPEN_SQL}
           RETURNING checkout_id`,
        )
        .bind(checkoutId, session.userId, productKey, now, expiresAt, now, cfg.foundingEndsAt, now, cfg.foundingEndsAt)
    : db
        .prepare('INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?) RETURNING checkout_id')
        .bind(checkoutId, session.userId, productKey, now, expiresAt);
  const results = await db.batch([expireOpen, reserve]);
  if ((results[1]?.results.length ?? 0) === 0) return renderAccountPage(rc, session, { error: FOUNDING_UNAVAILABLE_MESSAGE, status: 409 });

  const created = await createCheckout(cfg, rc.deps, {
    productId: cfg.productIds[productKey],
    requestId: checkoutId,
    successUrl: `${rc.config.publicBaseUrl}/account?checkout=done`,
    metadata: { overdeck_user_id: session.userId, overdeck_checkout_id: checkoutId },
  });
  if (!created.ok) {
    await db.prepare('UPDATE checkouts SET expires_at = ? WHERE checkout_id = ?').bind(rc.deps.now(), checkoutId).run();
    return renderAccountPage(rc, session, { error: CHECKOUT_FAILED_MESSAGE, status: 502 });
  }
  await db.prepare('UPDATE checkouts SET creem_checkout_id = ? WHERE checkout_id = ?').bind(created.checkoutId, checkoutId).run();
  return interstitial(CHECKOUT_HEADING, created.checkoutUrl, CHECKOUT_LINK_TEXT, CARD_NOTE);
};

/** POST /account/billing/relay — move a paying subscription to its relay pair (FR-8). */
export const relay: Handler = async (req, rc) => {
  const p = await prelude(req, rc);
  if (!p.ok) return p.response;
  const { session, form, cfg } = p;
  const action = form.get('action');
  if (action !== 'add' && action !== 'remove') return renderAccountPage(rc, session, { error: CHOOSE_RELAY_ACTION_MESSAGE, status: 400 });
  const now = rc.deps.now();
  const { paid } = billingStateFor(await loadSubscriptions(rc, session.userId), now);
  if (paid === null) return renderAccountPage(rc, session, { error: NO_SUBSCRIPTION_MESSAGE, status: 404 });
  if (paid.status === 'canceled') return renderAccountPage(rc, session, { error: SUBSCRIPTION_ENDING_MESSAGE, status: 409 });
  if (PRODUCTS[paid.productKey].relay === (action === 'add')) return redirect('/account', 303);

  const target = relayPair(paid.productKey);
  const upgraded = await upgradeSubscription(cfg, rc.deps, paid.subscriptionId, cfg.productIds[target]);
  if (!upgraded.ok) return renderAccountPage(rc, session, { error: UPGRADE_FAILED_MESSAGE, status: 502 });
  // The product Creem reports wins; the requested pair is the fallback when the answer names none we sell.
  const answered = idOf(upgraded.subscription.product);
  const productKey = (answered === null ? undefined : cfg.productKeyById.get(answered)) ?? target;
  const after = rc.deps.now();
  // last_event_at moves to now so a delayed pre-upgrade webhook cannot put the old product back (D-9).
  await rc.env.DB.prepare('UPDATE subscriptions SET product_key = ?, updated_at = ?, last_event_at = MAX(last_event_at, ?) WHERE subscription_id = ?')
    .bind(productKey, after, after, paid.subscriptionId)
    .run();
  return redirect('/account', 303);
};

/** POST /account/billing/portal — the Creem customer portal for the user's newest subscription (FR-9). */
export const portal: Handler = async (req, rc) => {
  const p = await prelude(req, rc);
  if (!p.ok) return p.response;
  const { session, cfg } = p;
  const newest = (await loadSubscriptions(rc, session.userId))[0];
  if (newest === undefined) return renderAccountPage(rc, session, { error: NO_SUBSCRIPTION_MESSAGE, status: 404 });
  const link = await portalLink(cfg, rc.deps, newest.customer_id);
  if (!link.ok) return renderAccountPage(rc, session, { error: PORTAL_FAILED_MESSAGE, status: 502 });
  return interstitial(PORTAL_HEADING, link.url, PORTAL_LINK_TEXT, null);
};

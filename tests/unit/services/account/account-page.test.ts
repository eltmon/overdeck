import { describe, expect, it } from 'vitest';
import type { DirectoryMachine, DirectoryView } from '../../../../services/account/src/directory-view.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import { BILLING_MESSAGE, INVITE_ONLY_PAID_MESSAGE } from '../../../../services/account/src/account-page/page.ts';
import {
  ADD_RELAY_BUTTON,
  ANNUAL_OPTION,
  CHECKOUT_PENDING_MESSAGE,
  FOUNDING_LOCKED_MESSAGE,
  FOUNDING_OPTION,
  lapsedGraceText,
  MANAGE_BILLING_BUTTON,
  MONTHLY_OPTION,
  PAST_DUE_MESSAGE,
  PLAN_LABEL_ANYWHERE,
  PLAN_LABEL_ANYWHERE_RELAY,
  PLAN_LABEL_FREE,
  RELAY_NOT_IN_PLAN_MESSAGE,
  RELAY_OPTION,
  REMOVE_RELAY_BUTTON,
  SUBSCRIBE_BUTTON,
} from '../../../../services/account/src/billing/page-sections.ts';
import { escapeHtml } from '../../../../services/account/src/pages.ts';
import { makeAccountClient, type AccountUser } from './helpers/account.ts';
import { billingEnv, seedSubscription } from './helpers/billing.ts';
import { dbOf, fakeCtx, makeDeps, makeEnv } from './helpers/harness.ts';

const NOW = Date.UTC(2026, 10, 15, 12);
const TESS: AccountUser = { githubId: 500, login: 'tess' };
const CAP = 50_000_000_000;

interface DirectoryCall {
  name: string;
  path: string;
  method: string;
  body: string;
}

/** A fake DIRECTORY namespace: `answer` decides each response; every call is recorded. */
function fakeDirectory(answer: (path: string, req: Request) => Response | Promise<Response>) {
  const calls: DirectoryCall[] = [];
  const namespace = {
    idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
    get: (id: { name: string }) =>
      ({
        async fetch(input: RequestInfo, init?: RequestInit) {
          const req = new Request(input, init);
          const path = new URL(req.url).pathname;
          calls.push({ name: id.name, path, method: req.method, body: await req.text() });
          return answer(path, req);
        },
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
  return { namespace, calls };
}

function machine(n: number, online: boolean, label = `machine-${n}`): DirectoryMachine {
  return { environmentId: `env-${n}`, label, online, lastSeenAt: new Date(Date.UTC(2026, 10, n)).toISOString(), serverVersion: `0.7${n}.0`, deviceId: `d-${n}` };
}

function viewOf(machines: DirectoryMachine[], bytesUsed = 0): DirectoryView {
  return { machines, relay: { month: '2026-11', bytesUsed, capBytes: CAP, stopped: bytesUsed >= CAP } };
}

async function seedGrant(env: Env, who: AccountUser, entitlement: 'free' | 'tester', expiresAt: number | null = null) {
  await dbOf(env)
    .prepare("INSERT INTO grants (github_id, github_login, entitlement, granted_at, expires_at, granted_via) VALUES (?, ?, ?, ?, ?, 'admin-add')")
    .bind(who.githubId, who.login, entitlement, 0, expiresAt)
    .run();
}

/** A signed-in user with a grant and, unless `view` is undefined, a DIRECTORY answering `view`. */
async function signedIn(opts: { entitlement?: 'free' | 'tester'; expiresAt?: number | null; view?: DirectoryView | 'throw' } = {}) {
  const directory = opts.view === undefined
    ? null
    : fakeDirectory(() => {
      if (opts.view === 'throw') throw new Error('directory down');
      return Response.json(opts.view);
    });
  const env = makeEnv(directory ? { DIRECTORY: directory.namespace } : {});
  const deps = makeDeps({ now: NOW });
  await seedGrant(env, TESS, opts.entitlement ?? 'tester', opts.expiresAt ?? null);
  const client = await makeAccountClient(env, deps, 'u-tess', TESS);
  return { env, deps, client, calls: directory?.calls ?? [] };
}

describe('account page (PAN-4959 WI-6)', () => {
  it('shows a tester their plan, relay use with the reset date, and both machines with status', async () => {
    const { client, calls } = await signedIn({ view: viewOf([machine(1, true, 'desk'), machine(2, false, 'laptop')], 12_300_000_000) });
    const res = await client.get();
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const text of [
      '<h1>Your Overdeck account</h1>',
      'Signed in as tess (GitHub id 500)',
      '<h2>Plan</h2>',
      'Tester',
      'Access: No expiry',
      'Paid plans are invite-only for now.',
      '<h2>Relay</h2>',
      '12.3 of 50 GB relay traffic this month',
      'Resets on 2026-12-01 (UTC).',
      '<h2>Machines</h2>',
      '2 machines',
      'desk',
      'laptop',
      'Online',
      'Offline',
      '2026-11-01 00:00 UTC',
      '0.71.0',
      'action="/account/machines/env-1/remove"',
      'Remove signs that machine out of overdeck.ai and frees its place. Sign in on it again to add it back.',
      '<h2>Billing</h2>',
      '<h2>Delete account</h2>',
      'Deleting your account signs out every device, removes your machines from the directory and deletes all of your hosted data within 24 hours.',
      '<form method="post" action="/account/delete">',
    ]) {
      expect(body, text).toContain(text);
    }
    expect(body).not.toContain('Relay allowance used');
    expect(calls).toEqual([{ name: 'u-tess', path: '/account-view', method: 'GET', body: '' }]);
    // Sections appear in the FR order.
    const order = ['<h2>Plan</h2>', '<h2>Relay</h2>', '<h2>Machines</h2>', '<h2>Billing</h2>', '<h2>Delete account</h2>'].map((h) => body.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows a free account its machine count against the limit and no relay', async () => {
    const { client } = await signedIn({ entitlement: 'free', view: viewOf([machine(1, true)]) });
    const body = await (await client.get()).text();
    expect(body).toContain('Free account');
    expect(body).toContain('1 of 3 machines');
    expect(body).toContain('The relay is not included in the free account.');
    expect(body).not.toContain('relay traffic this month');
  });

  it('says the relay allowance is used when the relay is stopped', async () => {
    const { client } = await signedIn({ view: viewOf([], CAP) });
    const body = await (await client.get()).text();
    expect(body).toContain('50.0 of 50 GB relay traffic this month');
    expect(body).toContain('Relay allowance used; it resets on 2026-12-01.');
    expect(body).toContain('0 machines');
  });

  it('without DIRECTORY, or when the DO throws, says machines and relay are unavailable and shows no Remove form', async () => {
    for (const view of [undefined, 'throw'] as const) {
      const { client } = await signedIn({ view });
      const res = await client.get();
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.split('Machines and relay use are unavailable right now.')).toHaveLength(3);
      expect(body).not.toContain('/account/machines/');
      expect(body).toContain('Tester');
    }
  });

  it('shows the billing sentence, no dollar sign anywhere, and escapes a hostile label', async () => {
    const { client } = await signedIn({ view: viewOf([machine(1, true, '<script>alert(1)</script>')]) });
    const body = await (await client.get()).text();
    expect(body).toContain('Billing is not available yet. Paid plans are invite-only for now.');
    expect(body).not.toContain('$');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>');
  });

  it('shows an expired free grant as the free plan with its expiry date', async () => {
    const { client } = await signedIn({ entitlement: 'free', expiresAt: Date.UTC(2026, 10, 1), view: viewOf([]) });
    const res = await client.get();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Free account');
    expect(body).toContain('Expired on 2026-11-01');
  });

  it('shows a future expiry date and the owner as Tester with no expiry', async () => {
    const future = await signedIn({ expiresAt: Date.UTC(2027, 0, 31), view: viewOf([]) });
    expect(await (await future.client.get()).text()).toContain('Access: Expires on 2027-01-31');

    const env = makeEnv();
    const deps = makeDeps({ now: NOW });
    const owner = await makeAccountClient(env, deps, 'u-owner');
    const body = await (await owner.get()).text();
    expect(body).toContain('Tester');
    expect(body).toContain('Access: No expiry');
  });
});

describe('removing a machine from the account page (PAN-4959 WI-7)', () => {
  /** A tester with machines 1 and 2 in the directory and an active devices row for each. */
  async function withMachines(remove: (req: Request) => Response = () => Response.json({ removed: true }), viewAnswer?: () => Response) {
    const directory = fakeDirectory((path, req) => {
      if (path === '/remove-machine') return remove(req);
      return viewAnswer ? viewAnswer() : Response.json(viewOf([machine(1, true), machine(2, false)]));
    });
    const env = makeEnv({ DIRECTORY: directory.namespace });
    const deps = makeDeps({ now: NOW });
    await seedGrant(env, TESS, 'tester');
    const client = await makeAccountClient(env, deps, 'u-tess', TESS);
    for (const n of [1, 2]) {
      await dbOf(env)
        .prepare('INSERT INTO devices (device_id, user_id, token_hash, platform, label, environment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(`d-${n}`, 'u-tess', `hash-${n}`, 'linux-x64', `machine-${n}`, `env-${n}`, 0)
        .run();
    }
    const revoked = async () =>
      (await dbOf(env).prepare('SELECT device_id, revoked_by FROM devices WHERE revoked_at IS NOT NULL ORDER BY device_id').all<{ device_id: string; revoked_by: string }>()).results;
    return { env, deps, client, calls: directory.calls, revoked };
  }

  it('revokes the machine device, removes it from the directory and answers 303 to /account', async () => {
    const { client, calls, revoked } = await withMachines();
    const res = await client.post('/account/machines/env-1/remove');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account');
    expect(await revoked()).toEqual([{ device_id: 'd-1', revoked_by: 'user' }]);
    expect(calls.filter((c) => c.path === '/remove-machine')).toEqual([{ name: 'u-tess', path: '/remove-machine', method: 'POST', body: '{"environmentId":"env-1"}' }]);
  });

  it('treats a machine the DO already forgot as removed', async () => {
    const { client, revoked } = await withMachines(() => Response.json({ error: 'unknown_machine' }, { status: 404 }));
    expect((await client.post('/account/machines/env-2/remove')).status).toBe(303);
    expect(await revoked()).toEqual([{ device_id: 'd-2', revoked_by: 'user' }]);
  });

  it('refuses a post without csrf or from another origin with 403 and revokes nothing', async () => {
    const { client, calls, revoked } = await withMachines();
    expect((await client.post('/account/machines/env-1/remove', {}, { csrf: null })).status).toBe(403);
    expect((await client.post('/account/machines/env-1/remove', {}, { csrf: 'ff'.repeat(16) })).status).toBe(403);
    const foreign = await client.post('/account/machines/env-1/remove', {}, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toContain('Request rejected.');
    expect(await revoked()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers 404 with the page when the machine is not in the directory', async () => {
    const { client, revoked } = await withMachines();
    const res = await client.post('/account/machines/env-9/remove');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('That machine is no longer in the directory.');
    expect(body).toContain('<h2>Machines</h2>');
    expect(await revoked()).toEqual([]);
  });

  it('answers 503 with the unavailable sentence when the directory throws, revoking nothing', async () => {
    const { client, revoked } = await withMachines(undefined, () => {
      throw new Error('directory down');
    });
    const res = await client.post('/account/machines/env-1/remove');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Machines and relay use are unavailable right now.');
    expect(await revoked()).toEqual([]);
  });

  it('answers 503 when the directory lists the machine but cannot remove it', async () => {
    const { client } = await withMachines(() => new Response(null, { status: 500 }));
    const res = await client.post('/account/machines/env-1/remove');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Machines and relay use are unavailable right now.');
  });
});

describe('deleting the account from the page (PAN-4959 WI-8)', () => {
  /** A vault holder that fails keeps the deletion job open, so the users row (and deleted_at) stays readable. */
  async function deleting(vaultFails = false) {
    const env = makeEnv(vaultFails ? { VAULT: { deleteAccountData: async () => { throw new Error('vault down'); } } } : {});
    const deps = makeDeps({ now: NOW });
    await seedGrant(env, TESS, 'tester');
    const client = await makeAccountClient(env, deps, 'u-tess', TESS);
    const deletedAt = () => dbOf(env).prepare('SELECT deleted_at FROM users WHERE user_id = ?').bind('u-tess').first<number | null>('deleted_at');
    const sessions = () => dbOf(env).prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = 'u-tess'").first<number>('n');
    return { env, deps, client, deletedAt, sessions };
  }

  it('POST /account/delete shows the confirm page and deletes nothing', async () => {
    const { client, deletedAt } = await deleting();
    const res = await client.post('/account/delete');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Deleting your account signs out every device, removes your machines from the directory and deletes all of your hosted data within 24 hours.');
    expect(body).toContain('<form method="post" action="/account/delete/confirm">');
    expect(body).toContain('name="confirm"');
    expect(body).toContain(`<input type="hidden" name="csrf" value="${client.csrf}">`);
    expect(body).toContain('Delete my account');
    expect(body).toContain('<a href="/account">Cancel</a>');
    expect(await deletedAt()).toBeNull();
  });

  it('refuses POST /account/delete and /account/delete/confirm without csrf', async () => {
    const { client, deletedAt } = await deleting();
    expect((await client.post('/account/delete', {}, { csrf: null })).status).toBe(403);
    expect((await client.post('/account/delete/confirm', { confirm: 'tess' }, { csrf: null })).status).toBe(403);
    expect(await deletedAt()).toBeNull();
  });

  it('a login that does not match answers 400 with the confirm page and deletes nothing', async () => {
    const { client, deletedAt, sessions } = await deleting();
    const res = await client.post('/account/delete/confirm', { confirm: 'someone-else' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Type your GitHub login to confirm.');
    expect(body).toContain('<form method="post" action="/account/delete/confirm">');
    expect(await deletedAt()).toBeNull();
    expect(await sessions()).toBe(1);
  });

  it('the login in another letter case starts deletion, ends every web session and clears the cookie', async () => {
    const { env, deps, client, deletedAt, sessions } = await deleting(true);
    await dbOf(env)
      .prepare('INSERT INTO user_sessions (session_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind('second-session', 'u-tess', 'x', deps.now(), deps.now() + 1000)
      .run();
    const ctx = fakeCtx();
    const res = await client.post('/account/delete/confirm', { confirm: 'TESS' }, { ctx });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Your account is being deleted.');
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-od_account=;/);
    expect(await sessions()).toBe(0);
    expect(ctx.pending).toHaveLength(1);
    await ctx.drain();
    // The job ran with the request; the failing vault keeps it open, so the users row is still there.
    expect(await deletedAt()).toBe(NOW);
    expect(await dbOf(env).prepare('SELECT requested_at, completed_at, last_error FROM deletion_jobs WHERE user_id = ?').bind('u-tess').first()).toEqual({ requested_at: NOW, completed_at: null, last_error: 'vault down' });
    // The old cookie no longer opens the page.
    expect(await (await client.get()).text()).toContain('Sign in with GitHub');
  });
});

describe('account page billing states (PAN-4294 WI-6)', () => {
  const DAY = 86_400_000;
  const PAID_THROUGH = Date.UTC(2027, 0, 2);

  async function billed(opts: { entitlement?: 'free' | 'tester'; billing?: boolean } = {}) {
    const directory = fakeDirectory(() => Response.json(viewOf([machine(1, true), machine(2, true), machine(3, true), machine(4, false)], 1_000_000_000)));
    const env = makeEnv({ DIRECTORY: directory.namespace, ...(opts.billing === false ? {} : billingEnv()) });
    const deps = makeDeps({ now: NOW });
    await seedGrant(env, TESS, opts.entitlement ?? 'free');
    const client = await makeAccountClient(env, deps, 'u-tess', TESS);
    return { env, deps, client };
  }

  function billingPart(body: string): string {
    return body.slice(body.indexOf('<h2>Billing</h2>'), body.indexOf('<h2>Delete account</h2>'));
  }

  function planPart(body: string): string {
    return body.slice(body.indexOf('<h2>Plan</h2>'), body.indexOf('<h2>Relay</h2>'));
  }

  it('billing unconfigured: the Billing section is BILLING_MESSAGE with no billing form', async () => {
    const { client } = await billed({ billing: false });
    const body = await (await client.get()).text();
    expect(billingPart(body)).toBe(`<h2>Billing</h2>\n<p>${BILLING_MESSAGE}</p>\n`);
    expect(body).not.toContain('/account/billing/');
    expect(planPart(body)).toContain(INVITE_ONLY_PAID_MESSAGE);
  });

  it('never subscribed: the subscribe form with every option, the founding places and no invite-only line', async () => {
    const { client } = await billed();
    const body = await (await client.get()).text();
    const billing = billingPart(body);
    for (const text of [
      '<form method="post" action="/account/billing/checkout">',
      'name="csrf" value="01010101010101010101010101010101"',
      `value="monthly"> ${escapeHtml(MONTHLY_OPTION)}`,
      `value="annual" checked> ${escapeHtml(ANNUAL_OPTION)}`,
      `value="founding"> ${escapeHtml(FOUNDING_OPTION)}`,
      '500 founding places left',
      `name="relay" value="1"> ${escapeHtml(RELAY_OPTION)}`,
      `<button type="submit">${SUBSCRIBE_BUTTON}</button>`,
    ]) {
      expect(billing, text).toContain(text);
    }
    expect(planPart(body)).not.toContain(INVITE_ONLY_PAID_MESSAGE);
    expect(billing).not.toContain(MANAGE_BILLING_BUTTON);
  });

  it('founding sold out: the founding option is gone', async () => {
    const { client, env } = await billed();
    for (let i = 0; i < 500; i++) await seedSubscription(env, { subscriptionId: `sub_${i}`, userId: `other${i}`, productKey: 'founding_annual', founding: 1, paidThrough: PAID_THROUGH });
    const billing = billingPart(await (await client.get()).text());
    expect(billing).not.toContain('value="founding"');
    expect(billing).not.toContain('founding places left');
    expect(billing).toContain(MONTHLY_OPTION);
  });

  it('checkout=done before Creem confirms: the payment-received line above the form', async () => {
    const { client } = await billed();
    const billing = billingPart(await (await client.get('/account?checkout=done')).text());
    expect(billing).toContain(CHECKOUT_PENDING_MESSAGE);
    expect(billing.indexOf(CHECKOUT_PENDING_MESSAGE)).toBeLessThan(billing.indexOf('/account/billing/checkout'));
  });

  it('paid without the relay: Anywhere, paid-through date, Add the relay, Manage billing, and unlimited machines', async () => {
    const { client, env } = await billed();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', productKey: 'anywhere_annual', paidThrough: PAID_THROUGH });
    const body = await (await client.get('/account?checkout=done')).text();
    expect(body).toContain(`<h2>Plan</h2>\n<p>${PLAN_LABEL_ANYWHERE}</p>\n<p>Paid through 2027-01-02</p>`);
    expect(body).toContain(RELAY_NOT_IN_PLAN_MESSAGE);
    expect(body).toContain('4 machines');
    const billing = billingPart(body);
    expect(billing).toContain(escapeHtml('Anywhere, annual, $96 a year'));
    expect(billing).toContain(`<input type="hidden" name="action" value="add"><button type="submit">${ADD_RELAY_BUTTON}</button>`);
    expect(billing).toContain(`action="/account/billing/portal"`);
    expect(billing).toContain(escapeHtml(MANAGE_BILLING_BUTTON));
    expect(billing).not.toContain(CHECKOUT_PENDING_MESSAGE);
    expect(billing).not.toContain('/account/billing/checkout');
    expect(planPart(body)).not.toContain(INVITE_ONLY_PAID_MESSAGE);
  });

  it('paid with the relay: Anywhere with the relay, relay traffic and Remove the relay', async () => {
    const { client, env } = await billed();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', productKey: 'anywhere_monthly_relay', paidThrough: PAID_THROUGH });
    const body = await (await client.get()).text();
    expect(body).toContain(`<p>${PLAN_LABEL_ANYWHERE_RELAY}</p>`);
    expect(body).toContain('1.0 of 50 GB relay traffic this month');
    const billing = billingPart(body);
    expect(billing).toContain(escapeHtml('Anywhere with the relay, monthly, $13 a month with the relay'));
    expect(billing).toContain(`value="remove"><button type="submit">${REMOVE_RELAY_BUTTON}</button>`);
  });

  it('founding: the locked-price line and the founding product', async () => {
    const { client, env } = await billed();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', productKey: 'founding_annual', founding: 1, paidThrough: PAID_THROUGH });
    const body = await (await client.get()).text();
    expect(body).toContain(FOUNDING_LOCKED_MESSAGE);
    expect(billingPart(body)).toContain(escapeHtml('Anywhere, founding price, $60 a year (founding price)'));
  });

  it('past due: the failed-payment warning while access lasts', async () => {
    const { client, env } = await billed();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', status: 'past_due', paidThrough: NOW - DAY });
    const body = await (await client.get()).text();
    expect(body).toContain(`<p>${PLAN_LABEL_ANYWHERE}</p>`);
    expect(billingPart(body)).toContain(escapeHtml(PAST_DUE_MESSAGE));
  });

  it('lapsed, in the grace period: the ended line with both dates, the subscribe form and Manage billing', async () => {
    const { client, env } = await billed();
    const lapsedAt = NOW - 10 * DAY;
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', status: 'canceled', paidThrough: lapsedAt });
    const body = await (await client.get()).text();
    expect(body).toContain(`<p>${PLAN_LABEL_FREE}</p>`);
    const billing = billingPart(body);
    expect(billing).toContain(escapeHtml(lapsedGraceText(lapsedAt, lapsedAt + 30 * DAY)));
    expect(billing).toContain('Your Anywhere plan ended on 2026-11-05. Until 2026-12-05 your hosted data stays readable and subscribing again restores everything.');
    expect(billing).toContain('/account/billing/checkout');
    expect(billing).toContain(escapeHtml(MANAGE_BILLING_BUTTON));
  });

  it('lapsed, in the export window: the deletion warning with its date', async () => {
    const { client, env } = await billed();
    const lapsedAt = NOW - 40 * DAY;
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', status: 'expired', paidThrough: lapsedAt });
    const billing = billingPart(await (await client.get()).text());
    expect(billing).toContain('Hosted vault data above the free 1 GB will be deleted on 2026-12-05. Export it now with pan vault migrate, or subscribe again.');
    expect(billing).toContain('/account/billing/checkout');
  });

  it('lapsed, after the deletion date: the deleted line', async () => {
    const { client, env } = await billed();
    const lapsedAt = NOW - 61 * DAY;
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-tess', status: 'expired', paidThrough: lapsedAt });
    const billing = billingPart(await (await client.get()).text());
    expect(billing).toContain(`Hosted vault data above the free 1 GB was deleted on ${new Date(lapsedAt + 60 * DAY).toISOString().slice(0, 10)}.`);
    expect(billing).toContain('/account/billing/checkout');
  });
});

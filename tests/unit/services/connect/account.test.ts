import { describe, expect, it } from 'vitest';
import { connectPlanOf, verifyIdentity, type AccountBinding, type AccountVerifyResult } from '../../../../services/connect/src/account.ts';
import type { Env } from '../../../../services/connect/src/env.ts';

const TOKEN = `odd_${'a'.repeat(64)}`;

function envAnswering(result: AccountVerifyResult): Env {
  const ACCOUNT: AccountBinding = { verifyDevice: async () => result };
  return { DIRECTORY: {} as DurableObjectNamespace, ACCOUNT, PUBLIC_BASE_URL: 'https://c.test' };
}

function verified(entitlement: { plan: string; maxDevices: number | null; relay?: boolean }): AccountVerifyResult {
  return { ok: true, userId: 'u-1', githubId: 1, deviceId: 'd-1', entitlement };
}

describe('connect plan from the account entitlement (PAN-4294 connect-paid-plans)', () => {
  it('maps free and tester as-is and splits anywhere by the relay flag; anything else is null', () => {
    expect(connectPlanOf({ plan: 'free' })).toBe('free');
    expect(connectPlanOf({ plan: 'tester', relay: true })).toBe('tester');
    expect(connectPlanOf({ plan: 'anywhere', relay: true })).toBe('anywhere_relay');
    expect(connectPlanOf({ plan: 'anywhere', relay: false })).toBe('anywhere');
    expect(connectPlanOf({ plan: 'anywhere' })).toBe('anywhere');
    expect(connectPlanOf({ plan: 'gold' })).toBeNull();
    expect(connectPlanOf(undefined)).toBeNull();
  });

  it('verifyIdentity carries the anywhere plans and reports an unknown plan as account_service_outdated', async () => {
    expect(await verifyIdentity(envAnswering(verified({ plan: 'anywhere', maxDevices: null, relay: true })), `Bearer ${TOKEN}`)).toMatchObject({
      ok: true,
      identity: { plan: 'anywhere_relay', maxDevices: null },
    });
    expect(await verifyIdentity(envAnswering(verified({ plan: 'anywhere', maxDevices: null, relay: false })), `Bearer ${TOKEN}`)).toMatchObject({
      ok: true,
      identity: { plan: 'anywhere' },
    });
    expect(await verifyIdentity(envAnswering(verified({ plan: 'gold', maxDevices: null })), `Bearer ${TOKEN}`)).toEqual({
      ok: false,
      status: 503,
      error: 'account_service_outdated',
    });
  });
});

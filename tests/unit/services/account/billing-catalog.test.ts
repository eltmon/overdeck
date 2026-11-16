import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_RESERVATION_MS,
  FOUNDING_LIMIT,
  PRODUCT_KEYS,
  PRODUCTS,
  chooseProduct,
  parseBillingConfig,
  relayPair,
} from '../../../../services/account/src/billing/catalog.ts';
import type { Env } from '../../../../services/account/src/env.ts';

const PRODUCT_IDS = {
  anywhere_monthly: 'prod_m',
  anywhere_monthly_relay: 'prod_mr',
  anywhere_annual: 'prod_a',
  anywhere_annual_relay: 'prod_ar',
  founding_annual: 'prod_f',
  founding_annual_relay: 'prod_fr',
};

function env(overrides: Partial<Record<string, string | undefined>> = {}): Env {
  return {
    DB: {} as D1Database,
    CREEM_API_KEY: 'creem_test_key',
    CREEM_WEBHOOK_SECRET: 'whsec',
    CREEM_API_BASE: 'https://test-api.creem.io/',
    CREEM_PRODUCTS: JSON.stringify(PRODUCT_IDS),
    ...overrides,
  } as Env;
}

describe('billing catalog (PAN-4294 billing-schema-catalog)', () => {
  it.each(['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET', 'CREEM_API_BASE', 'CREEM_PRODUCTS'])('is off when %s is missing or blank', (name) => {
    expect(parseBillingConfig(env({ [name]: undefined }))).toBeNull();
    expect(parseBillingConfig(env({ [name]: '  ' }))).toBeNull();
  });

  it.each(PRODUCT_KEYS)('is off when CREEM_PRODUCTS lacks %s', (key) => {
    const ids: Record<string, string> = { ...PRODUCT_IDS };
    delete ids[key];
    expect(parseBillingConfig(env({ CREEM_PRODUCTS: JSON.stringify(ids) }))).toBeNull();
    expect(parseBillingConfig(env({ CREEM_PRODUCTS: JSON.stringify({ ...PRODUCT_IDS, [key]: '' }) }))).toBeNull();
  });

  it('is off for unparseable or non-object CREEM_PRODUCTS and for a product id used twice', () => {
    expect(parseBillingConfig(env({ CREEM_PRODUCTS: '{not json' }))).toBeNull();
    expect(parseBillingConfig(env({ CREEM_PRODUCTS: '[]' }))).toBeNull();
    expect(parseBillingConfig(env({ CREEM_PRODUCTS: JSON.stringify({ ...PRODUCT_IDS, founding_annual: 'prod_m' }) }))).toBeNull();
  });

  it('is off for an unparseable FOUNDING_ENDS_AT', () => {
    expect(parseBillingConfig(env({ FOUNDING_ENDS_AT: 'next summer' }))).toBeNull();
  });

  it('accepts https anywhere and http only on localhost', () => {
    expect(parseBillingConfig(env({ CREEM_API_BASE: 'http://api.creem.io' }))).toBeNull();
    expect(parseBillingConfig(env({ CREEM_API_BASE: 'not a url' }))).toBeNull();
    expect(parseBillingConfig(env({ CREEM_API_BASE: 'http://127.0.0.1:9999' }))?.apiBase).toBe('http://127.0.0.1:9999');
    expect(parseBillingConfig(env({ CREEM_API_BASE: 'http://localhost:9999/' }))?.apiBase).toBe('http://localhost:9999');
  });

  it('returns every product id and the reverse map for a complete configuration', () => {
    const config = parseBillingConfig(env({ FOUNDING_ENDS_AT: '2027-06-30T00:00:00Z' }));
    expect(config).not.toBeNull();
    expect(config?.apiKey).toBe('creem_test_key');
    expect(config?.webhookSecret).toBe('whsec');
    expect(config?.apiBase).toBe('https://test-api.creem.io');
    expect(config?.productIds).toEqual(PRODUCT_IDS);
    for (const key of PRODUCT_KEYS) expect(config?.productKeyById.get(PRODUCT_IDS[key])).toBe(key);
    expect(config?.productKeyById.size).toBe(6);
    expect(config?.foundingEndsAt).toBe(Date.UTC(2027, 5, 30));
    expect(parseBillingConfig(env())?.foundingEndsAt).toBeNull();
  });

  it('relayPair is an involution that toggles only the relay', () => {
    for (const key of PRODUCT_KEYS) {
      const pair = relayPair(key);
      expect(pair).not.toBe(key);
      expect(relayPair(pair)).toBe(key);
      expect(PRODUCTS[pair].relay).toBe(!PRODUCTS[key].relay);
      expect(PRODUCTS[pair].interval).toBe(PRODUCTS[key].interval);
      expect(PRODUCTS[pair].founding).toBe(PRODUCTS[key].founding);
    }
  });

  it('chooseProduct maps every choice to one key and founding forces annual', () => {
    expect(chooseProduct({ interval: 'month', relay: true, founding: true })).toBe('founding_annual_relay');
    expect(chooseProduct({ interval: 'month', relay: false, founding: true })).toBe('founding_annual');
    expect(chooseProduct({ interval: 'month', relay: false, founding: false })).toBe('anywhere_monthly');
    expect(chooseProduct({ interval: 'month', relay: true, founding: false })).toBe('anywhere_monthly_relay');
    expect(chooseProduct({ interval: 'year', relay: false, founding: false })).toBe('anywhere_annual');
    expect(chooseProduct({ interval: 'year', relay: true, founding: false })).toBe('anywhere_annual_relay');
  });

  it('keeps the decided price terms', () => {
    expect(FOUNDING_LIMIT).toBe(500);
    expect(CHECKOUT_RESERVATION_MS).toBe(3_600_000);
    expect(PRODUCT_KEYS.map((k) => PRODUCTS[k].priceText)).toEqual([
      '$10 a month',
      '$13 a month with the relay',
      '$96 a year',
      '$126 a year with the relay',
      '$60 a year (founding price)',
      '$90 a year with the relay (founding price)',
    ]);
  });
});

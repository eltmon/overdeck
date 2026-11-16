/**
 * Creem product catalog and billing configuration (PRD PAN-4294 WI-1, D-2, D-3, D-15).
 *
 * One Creem subscription product per combination of interval, relay add-on and founding price, because Creem's
 * upgrade endpoint supports single-item subscriptions only (D-2). Display strings must match the Creem products;
 * Creem's checkout shows the binding price (D-15).
 * Billing is enabled only when every value parseBillingConfig needs is present; no value has a hardcoded default.
 */
import type { Env } from '../env.ts';

export const PRODUCT_KEYS = [
  'anywhere_monthly',
  'anywhere_monthly_relay',
  'anywhere_annual',
  'anywhere_annual_relay',
  'founding_annual',
  'founding_annual_relay',
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

export interface Product {
  interval: 'month' | 'year';
  relay: boolean;
  founding: boolean;
  label: string;
  priceText: string;
}

export const PRODUCTS: Record<ProductKey, Product> = {
  anywhere_monthly: { interval: 'month', relay: false, founding: false, label: 'Anywhere, monthly', priceText: '$10 a month' },
  anywhere_monthly_relay: { interval: 'month', relay: true, founding: false, label: 'Anywhere with the relay, monthly', priceText: '$13 a month with the relay' },
  anywhere_annual: { interval: 'year', relay: false, founding: false, label: 'Anywhere, annual', priceText: '$96 a year' },
  anywhere_annual_relay: { interval: 'year', relay: true, founding: false, label: 'Anywhere with the relay, annual', priceText: '$126 a year with the relay' },
  founding_annual: { interval: 'year', relay: false, founding: true, label: 'Anywhere, founding price', priceText: '$60 a year (founding price)' },
  founding_annual_relay: {
    interval: 'year',
    relay: true,
    founding: true,
    label: 'Anywhere with the relay, founding price',
    priceText: '$90 a year with the relay (founding price)',
  },
};

/** The founding price ends at this many founding subscribers (or at FOUNDING_ENDS_AT, whichever comes first). */
export const FOUNDING_LIMIT = 500;

/** An unpaid checkout holds its founding place for 60 minutes (D-10). */
export const CHECKOUT_RESERVATION_MS = 3_600_000;

const RELAY_PAIRS: Record<ProductKey, ProductKey> = {
  anywhere_monthly: 'anywhere_monthly_relay',
  anywhere_monthly_relay: 'anywhere_monthly',
  anywhere_annual: 'anywhere_annual_relay',
  anywhere_annual_relay: 'anywhere_annual',
  founding_annual: 'founding_annual_relay',
  founding_annual_relay: 'founding_annual',
};

/** The same product with the relay add-on toggled. */
export function relayPair(key: ProductKey): ProductKey {
  return RELAY_PAIRS[key];
}

/** The one product key for a subscribe choice. The founding price is annual only, so founding forces `year`. */
export function chooseProduct(choice: { interval: 'month' | 'year'; relay: boolean; founding: boolean }): ProductKey {
  const interval = choice.founding ? 'year' : choice.interval;
  const key = PRODUCT_KEYS.find((k) => {
    const p = PRODUCTS[k];
    return p.interval === interval && p.relay === choice.relay && p.founding === choice.founding;
  });
  if (key === undefined) throw new Error('unreachable: every interval/relay/founding combination has a product');
  return key;
}

export function isProductKey(value: string): value is ProductKey {
  return (PRODUCT_KEYS as readonly string[]).includes(value);
}

export interface BillingConfig {
  apiKey: string;
  webhookSecret: string;
  /** No trailing slash. */
  apiBase: string;
  productIds: Record<ProductKey, string>;
  productKeyById: Map<string, ProductKey>;
  /** ms since epoch; null when no end date is set. */
  foundingEndsAt: number | null;
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseApiBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return raw.trim().replace(/\/+$/, '');
}

function parseProducts(raw: string): Record<ProductKey, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const ids = {} as Record<ProductKey, string>;
  for (const key of PRODUCT_KEYS) {
    const id = record[key];
    if (typeof id !== 'string' || id.trim() === '') return null;
    ids[key] = id.trim();
  }
  return ids;
}

/**
 * The billing configuration, or null when billing is off (FR-1): any of CREEM_API_KEY, CREEM_WEBHOOK_SECRET,
 * CREEM_API_BASE, CREEM_PRODUCTS missing, an API base that is not https (http only on localhost for tests),
 * a product map lacking any of the six keys or naming one product twice, or an unparseable FOUNDING_ENDS_AT (never sell founding forever).
 */
export function parseBillingConfig(env: Env): BillingConfig | null {
  const { CREEM_API_KEY, CREEM_WEBHOOK_SECRET, CREEM_API_BASE, CREEM_PRODUCTS, FOUNDING_ENDS_AT } = env;
  if (!present(CREEM_API_KEY) || !present(CREEM_WEBHOOK_SECRET) || !present(CREEM_API_BASE) || !present(CREEM_PRODUCTS)) return null;
  const apiBase = parseApiBase(CREEM_API_BASE);
  if (apiBase === null) return null;
  const productIds = parseProducts(CREEM_PRODUCTS);
  if (productIds === null) return null;
  let foundingEndsAt: number | null = null;
  if (present(FOUNDING_ENDS_AT)) {
    const parsed = Date.parse(FOUNDING_ENDS_AT.trim());
    if (Number.isNaN(parsed)) return null;
    foundingEndsAt = parsed;
  }
  const productKeyById = new Map<string, ProductKey>();
  for (const key of PRODUCT_KEYS) productKeyById.set(productIds[key], key);
  // Two keys sharing one Creem product would make webhook mapping ambiguous.
  if (productKeyById.size !== PRODUCT_KEYS.length) return null;
  return {
    apiKey: CREEM_API_KEY.trim(),
    webhookSecret: CREEM_WEBHOOK_SECRET.trim(),
    apiBase,
    productIds,
    productKeyById,
    foundingEndsAt,
  };
}

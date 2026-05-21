/**
 * Shared subscription and auth types.
 * Kept in a separate file to avoid circular dependencies
 * between config-yaml.ts and model-capabilities.ts.
 */

/**
 * Subscription plan tiers (for OAuth-authenticated providers)
 */
export type SubscriptionPlan = 'free' | 'plus' | 'pro';

/**
 * Provider authentication mode
 */
export type AuthMode = 'api-key' | 'subscription';

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Types-only module. No runtime functions to wrap.

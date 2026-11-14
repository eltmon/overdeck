/**
 * PR freshness policy (PAN-5224): while webhooks are healthy, GitHub webhooks
 * drive PR-listing freshness and polling is the fallback. The primary
 * dashboard registers the health provider (the system-health `smee-relay`
 * row); every other process keeps the default, "not healthy", which is
 * today's 30 s cadence.
 */
export const PR_LISTING_ACTIVE_TTL_MS = 30_000;
export const PR_LISTING_ACTIVE_TTL_HEALTHY_MS = 5 * 60_000;
export const PR_LISTING_IDLE_TTL_MS = 5 * 60_000;
export const PR_LISTING_IDLE_TTL_HEALTHY_MS = 15 * 60_000;
export const MEMBERSHIP_FALLBACK_MS = 5 * 60_000;
export const MEMBERSHIP_FALLBACK_HEALTHY_MS = 30 * 60_000;

let provider: () => boolean = () => false;

/** Register the webhook-health answer; returns a function restoring the default. */
export function setWebhookHealthProvider(fn: () => boolean): () => void {
  provider = fn;
  return () => { provider = () => false; };
}

/** True only while the registered provider says webhooks are delivered. Never throws (a throwing provider reads as false). */
export function webhooksHealthy(): boolean {
  try {
    return provider();
  } catch {
    return false;
  }
}

export function prListingActiveTtlMs(): number {
  return webhooksHealthy() ? PR_LISTING_ACTIVE_TTL_HEALTHY_MS : PR_LISTING_ACTIVE_TTL_MS;
}

export function prListingIdleTtlMs(): number {
  return webhooksHealthy() ? PR_LISTING_IDLE_TTL_HEALTHY_MS : PR_LISTING_IDLE_TTL_MS;
}

/** `trackerIsGitHub`: tryResolveProjectTrackerType(project) === 'github'. */
export function membershipFallbackMs(trackerIsGitHub: boolean): number {
  return webhooksHealthy() && trackerIsGitHub ? MEMBERSHIP_FALLBACK_HEALTHY_MS : MEMBERSHIP_FALLBACK_MS;
}

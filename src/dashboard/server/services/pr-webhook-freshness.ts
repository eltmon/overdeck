/**
 * PAN-5224: wires the PR freshness policy's webhook-health provider to the
 * primary dashboard's system-health sampler. Only the process that receives
 * `POST /api/webhooks/github` can vouch for the relay, so a peer dashboard
 * (which reads the same smee pidfile but never receives the webhook) never
 * registers — it keeps the library default, "not healthy".
 */
import { setWebhookHealthProvider } from '../../../lib/overdeck/pr-freshness.js';
import { isWebhookRelayRunningInLastSample } from './system-health-service.js';

/** Registers the webhook-health provider for the primary dashboard; a no-op for a peer. Returns the restore function. */
export function startPrWebhookFreshness(options: { isPeerDashboard: boolean }): () => void {
  if (options.isPeerDashboard) return () => undefined;
  return setWebhookHealthProvider(() => isWebhookRelayRunningInLastSample());
}

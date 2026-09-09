import type { RuntimeName } from '../runtimes/types.js';

interface DeliveryOutcome {
  ok: boolean;
  path: string;
  failure?: string;
}

/** Enforce native Kimi's mandatory context contract independently of role bookkeeping. */
export async function requireManagedKimiDelivery(options: {
  agentId: string;
  role: string;
  harness: RuntimeName;
  delivery: DeliveryOutcome;
  onFailure: () => Promise<void>;
}): Promise<void> {
  if (options.harness !== 'kimi-code' || options.delivery.ok) return;
  await options.onFailure();
  throw new Error(
    `Agent ${options.agentId} (${options.role}) managed Kimi context delivery failed: `
    + (options.delivery.failure ?? `delivery returned ok=false via ${options.delivery.path}`),
  );
}

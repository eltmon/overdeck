import { startProjectCiRefill } from '../../../lib/overdeck/project-ci-fill.js';
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';

let resolveProjectionReady!: () => void;
let projectionReady = false;
let projectionReadyPromise = createProjectionReadyPromise();

function createProjectionReadyPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveProjectionReady = resolve;
  });
}

/** Mark the event-store → read-model subscription as installed. */
export function markEventStoreProjectionReady(): void {
  if (projectionReady) return;
  projectionReady = true;
  resolveProjectionReady();
}

/** Wait until events appended by background services can reach the read model. */
export function whenEventStoreProjectionReady(): Promise<void> {
  return projectionReadyPromise;
}

/**
 * Start the periodic project-CI refill once the projection is ready. Returns
 * null, and starts nothing, in a peer dashboard (PAN-3931): a fill polls the
 * forge and appends durable `project.ci_*` events to the event log the peer
 * shares with the primary, which already runs the one refill.
 */
export async function startProjectCiRefillAfterProjectionReady(
  intervalMs: number,
  deps: {
    whenReady?: () => Promise<void>;
    start?: typeof startProjectCiRefill;
    isPeer?: () => boolean;
  } = {},
): Promise<ReturnType<typeof setInterval> | null> {
  if ((deps.isPeer ?? isPeerDashboardProcess)()) return null;
  await (deps.whenReady ?? whenEventStoreProjectionReady)();
  return (deps.start ?? startProjectCiRefill)(intervalMs);
}

export function resetEventStoreProjectionReadyForTests(): void {
  projectionReady = false;
  projectionReadyPromise = createProjectionReadyPromise();
}

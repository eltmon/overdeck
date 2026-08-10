import { startProjectCiRefill } from '../../../lib/overdeck/project-ci-fill.js';

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

export async function startProjectCiRefillAfterProjectionReady(
  intervalMs: number,
  deps: {
    whenReady?: () => Promise<void>;
    start?: typeof startProjectCiRefill;
  } = {},
): Promise<ReturnType<typeof setInterval>> {
  await (deps.whenReady ?? whenEventStoreProjectionReady)();
  return (deps.start ?? startProjectCiRefill)(intervalMs);
}

export function resetEventStoreProjectionReadyForTests(): void {
  projectionReady = false;
  projectionReadyPromise = createProjectionReadyPromise();
}

/**
 * In-page render probe for the PAN-4560 render profiler.
 *
 * render-profile.spec.ts bundles this file to an IIFE and installs it as a
 * Playwright init script, so bippy's React DevTools hook exists before
 * react-dom evaluates. Each commit, every composite fiber that rendered is
 * recorded by display name with its phase and `selfBaseDuration` (non-zero
 * only in a profiling build: `vite build --mode profile`).
 *
 * The page exposes `window.__renderProbe.begin(label)` to start a scenario
 * window and `end()` to read it back.
 */
import { getDisplayName, instrument, isCompositeFiber, traverseRenderedFibers, type Fiber } from 'bippy';

export interface ComponentStats {
  updates: number;
  mounts: number;
  selfMs: number;
}

export interface ScenarioRecord {
  label: string;
  commits: number;
  storeSets: number;
  byComponent: Record<string, ComponentStats>;
}

interface StoreLike {
  subscribe(listener: () => void): () => void;
}

interface ProbeWindow {
  useDashboardStore?: StoreLike;
  __renderProbe?: {
    begin(label: string): void;
    end(): ScenarioRecord;
    readonly commits: number;
  };
}

const probeWindow = window as unknown as ProbeWindow;

let label = '';
let commits = 0;
let storeSets = 0;
let byComponent: Record<string, ComponentStats> = {};
let storeSubscribed = false;

/** Names an unnamed component (an inline `memo`/`forwardRef` arrow) after its nearest named ancestor. */
function componentName(fiber: Fiber): string {
  const own = getDisplayName(fiber.type);
  if (own) return own;
  for (let parent = fiber.return; parent; parent = parent.return) {
    if (!isCompositeFiber(parent)) continue;
    const name = getDisplayName(parent.type);
    if (name) return `Anonymous in ${name}`;
  }
  return 'Anonymous';
}

instrument({
  onCommitFiberRoot(_rendererId, root) {
    commits += 1;
    traverseRenderedFibers(root, (fiber, phase) => {
      if (phase === 'unmount' || !isCompositeFiber(fiber)) return;
      const name = componentName(fiber);
      const stats = (byComponent[name] ??= { updates: 0, mounts: 0, selfMs: 0 });
      if (phase === 'mount') stats.mounts += 1;
      else stats.updates += 1;
      stats.selfMs += fiber.selfBaseDuration ?? 0;
    });
  },
});

probeWindow.__renderProbe = {
  begin(nextLabel: string) {
    // The store module loads after this init script, so subscribe on first use.
    if (!storeSubscribed && probeWindow.useDashboardStore) {
      probeWindow.useDashboardStore.subscribe(() => {
        storeSets += 1;
      });
      storeSubscribed = true;
    }
    label = nextLabel;
    commits = 0;
    storeSets = 0;
    byComponent = {};
  },
  end(): ScenarioRecord {
    return { label, commits, storeSets, byComponent };
  },
  get commits() {
    return commits;
  },
};

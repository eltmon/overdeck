import { exec } from 'child_process';
import { promisify } from 'util';

import { emitActivityEntrySync } from '../activity-logger.js';
import {
  assessBridgePoolPressure,
  bridgePoolLimitFromPools,
  DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
  formatBridgePoolBreakdown,
  LIST_BRIDGE_NETWORKS_COMMAND,
  parseBridgeNetworkNames,
  readDockerDaemonPools,
} from '../docker-bridge-pool.js';

const execAsync = promisify(exec);

/**
 * Docker bridge-pool pressure patrol (PAN-3053).
 *
 * Pool exhaustion halts the pipeline silently: `docker network create` refuses,
 * so workspace rebuild fails, so queued review feedback is never delivered, and
 * the agents waiting on it sit producing nothing while the dashboard reports
 * them healthy. The only trace of the real cause was prose inside one agent's
 * pane. This patrol turns that into a live signal — read-only, it never removes
 * a network.
 *
 * It emits on transitions only, so a sustained condition warns once rather than
 * once per 60s patrol cycle, and reports recovery when the pressure clears.
 */

type PressureLevel = 'ok' | 'warn' | 'exhausted';

export interface BridgePoolPatrolDeps {
  listBridgeNetworkNames: () => Promise<string[]>;
  readPools: () => Promise<unknown[] | null>;
  emit: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/** Last reported level. Module-level so it survives across patrol cycles. */
let lastLevel: PressureLevel = 'ok';

/** Test-only: reset the transition memory between cases. */
export function __resetBridgePoolPatrolState(): void {
  lastLevel = 'ok';
}

function defaultDeps(): BridgePoolPatrolDeps {
  return {
    listBridgeNetworkNames: async () => {
      const { stdout } = await execAsync(LIST_BRIDGE_NETWORKS_COMMAND, { timeout: 15000 });
      return parseBridgeNetworkNames(stdout);
    },
    readPools: readDockerDaemonPools,
    emit: (level, message) => {
      emitActivityEntrySync({ source: 'cloister', level, message });
    },
  };
}

export async function patrolDockerBridgePool(
  deps: Partial<BridgePoolPatrolDeps> = {},
): Promise<string[]> {
  const d = { ...defaultDeps(), ...deps };

  let names: string[];
  try {
    names = await d.listBridgeNetworkNames();
  } catch {
    return []; // docker not reachable — skip this cycle
  }

  const pools = await d.readPools().catch(() => null);
  const pressure = assessBridgePoolPressure(
    names,
    bridgePoolLimitFromPools(pools) ?? DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
  );

  const level: PressureLevel = pressure.exhausted
    ? 'exhausted'
    : pressure.underPressure
      ? 'warn'
      : 'ok';

  if (level === lastLevel) return [];
  const previous = lastLevel;
  lastLevel = level;

  const breakdown = formatBridgePoolBreakdown(pressure.groups);
  const detail = breakdown ? ` (${breakdown})` : '';

  if (level === 'ok') {
    const action = `Docker bridge network pool recovered — ${pressure.total} of ~${pressure.limit} slots used, ${pressure.headroom} free${detail}`;
    d.emit('info', `[deacon] ${action}`);
    console.log(`[deacon] ${action}`);
    return [action];
  }

  const action = level === 'exhausted'
    ? `Docker bridge network pool EXHAUSTED — ${pressure.total} of ~${pressure.limit} slots used; workspace stacks cannot be rebuilt and queued agent feedback will not be delivered${detail}`
    : `Docker bridge network pool under pressure — ${pressure.total} of ~${pressure.limit} slots used, only ${pressure.headroom} left${detail}`;

  d.emit(level === 'exhausted' ? 'error' : 'warn', `[deacon] ${action}`);
  console.warn(`[deacon] ${action} (was ${previous})`);
  return [action];
}

import { platform as getPlatform } from 'node:os';

import { createDarwinHostHealthCollector } from './darwin.js';
import { createLinuxHostHealthCollector } from './linux.js';
import {
  unavailable,
  type HostHealthCollector,
  type HostMetricSample,
  type HostPlatform,
} from './types.js';

export interface ProcessTreeRow {
  pid: number;
  ppid: number;
}

export interface ProcessTreeIndex {
  childrenByParent: ReadonlyMap<number, readonly number[]>;
}

export function buildProcessTreeIndex(rows: Iterable<ProcessTreeRow>): ProcessTreeIndex {
  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid);
    if (children) children.push(row.pid);
    else childrenByParent.set(row.ppid, [row.pid]);
  }
  return { childrenByParent };
}

export function collectDescendantPids(rootPid: number, index: ProcessTreeIndex): Set<number> {
  const descendants = new Set<number>();
  const queue = [rootPid];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid == null || descendants.has(pid)) continue;
    descendants.add(pid);
    queue.push(...(index.childrenByParent.get(pid) ?? []));
  }

  return descendants;
}

function createUnsupportedCollector(platform: HostPlatform = 'unsupported'): HostHealthCollector {
  const signal = () => unavailable('Host health collection is unsupported on this platform.');
  return {
    platform,
    async sample(): Promise<HostMetricSample> {
      return {
        platform,
        sampledAtMs: Date.now(),
        cpuPercent: signal(),
        loadAverage1m: signal(),
        loadPerCore1m: signal(),
        totalMemoryBytes: signal(),
        usedMemoryBytes: signal(),
        availableMemoryBytes: signal(),
        memoryUsedPercent: signal(),
        memoryPressureSomeAvg10: signal(),
        memoryPressureFullAvg10: signal(),
        memoryPressureFreePercent: signal(),
        swapTotalBytes: signal(),
        swapUsedBytes: signal(),
        swapUsedPercent: signal(),
        swapActivityBytesPerMinute: signal(),
        committedMemoryBytes: signal(),
        commitLimitBytes: signal(),
        virtualCommitmentPercent: signal(),
        counters: { cpu: null, swap: null },
      };
    },
  };
}

export interface HostCollectorSelection {
  platform?: NodeJS.Platform;
  linux?: HostHealthCollector;
  darwin?: HostHealthCollector;
}

export function createHostHealthCollector(
  selection: HostCollectorSelection = {},
): HostHealthCollector {
  const platform = selection.platform ?? getPlatform();
  if (platform === 'linux') return selection.linux ?? createLinuxHostHealthCollector();
  if (platform === 'darwin') return selection.darwin ?? createDarwinHostHealthCollector();
  return createUnsupportedCollector();
}

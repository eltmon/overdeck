import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../../../../lib/paths.js';
import type { HostVitalsSnapshot } from './host-vitals.js';
import type { ResourceStack } from './stacks.js';

export interface StackPeakRecord {
  stackId: string;
  issueId: string | null;
  composeProject: string;
  peakRamBytes: number;
  peakCpuPercent: number;
  updatedAt: string;
}

export interface StackForecastRow {
  stackId: string;
  issueId: string | null;
  composeProject: string;
  predictedRamBytes: number;
  predictedLoad: number;
  approximate: true;
  source: 'last-run-peak' | 'fleet-median';
}

export interface CapacityForecastPayload {
  stacks: StackForecastRow[];
  headroom: {
    freeRamBytes: number;
    loadHeadroom: number;
  };
}

interface ForecastStore {
  peaks: Record<string, StackPeakRecord>;
}

let forecastStateFileForTests: string | null = null;
let runtimePeaks = new Map<string, StackPeakRecord>();

export function buildCapacityForecast(
  stacks: ResourceStack[],
  options: { hostVitals: HostVitalsSnapshot },
): CapacityForecastPayload {
  const records = loadForecastStore().peaks;
  const median = medianPeak(Object.values(records).map((record) => record.peakRamBytes));

  return {
    stacks: stacks
      .filter((stack) => stack.services.every((service) => service.status === 'stopped'))
      .map((stack) => {
        const record = records[stack.id];
        const predictedRamBytes = record?.peakRamBytes ?? median;
        return {
          stackId: stack.id,
          issueId: stack.issueId,
          composeProject: stack.composeProject,
          predictedRamBytes,
          predictedLoad: record?.peakCpuPercent ?? 0,
          approximate: true as const,
          source: record ? 'last-run-peak' as const : 'fleet-median' as const,
        };
      }),
    headroom: {
      freeRamBytes: options.hostVitals.mem.availableBytes,
      loadHeadroom: Math.max(0, 100 - options.hostVitals.cpu.percent),
    },
  };
}

export function recordStackForecastSample(stacks: ResourceStack[], observedAt = new Date().toISOString()): void {
  for (const stack of stacks) {
    if (!stack.services.some((service) => service.status === 'running')) continue;
    const previous = runtimePeaks.get(stack.id);
    runtimePeaks.set(stack.id, {
      stackId: stack.id,
      issueId: stack.issueId,
      composeProject: stack.composeProject,
      peakRamBytes: Math.max(previous?.peakRamBytes ?? 0, stack.aggregates.memoryBytes),
      peakCpuPercent: Math.max(previous?.peakCpuPercent ?? 0, stack.aggregates.cpuPercent),
      updatedAt: observedAt,
    });
  }
}

export function persistStackForecastPeak(stack: ResourceStack, observedAt = new Date().toISOString()): StackPeakRecord {
  const runtimePeak = runtimePeaks.get(stack.id);
  const record: StackPeakRecord = {
    stackId: stack.id,
    issueId: stack.issueId,
    composeProject: stack.composeProject,
    peakRamBytes: Math.max(runtimePeak?.peakRamBytes ?? 0, stack.aggregates.memoryBytes),
    peakCpuPercent: Math.max(runtimePeak?.peakCpuPercent ?? 0, stack.aggregates.cpuPercent),
    updatedAt: observedAt,
  };
  const store = loadForecastStore();
  store.peaks[stack.id] = record;
  saveForecastStore(store);
  runtimePeaks.delete(stack.id);
  return record;
}

export function setForecastStateFileForTests(filePath: string): void {
  forecastStateFileForTests = filePath;
  runtimePeaks = new Map();
}

export function resetCapacityForecastForTests(): void {
  forecastStateFileForTests = null;
  runtimePeaks = new Map();
}

function forecastStateFile(): string {
  return forecastStateFileForTests ?? join(getOverdeckHome(), 'resource-forecast-peaks.json');
}

function loadForecastStore(): ForecastStore {
  const file = forecastStateFile();
  if (!existsSync(file)) return { peaks: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ForecastStore>;
    return { peaks: parsed.peaks ?? {} };
  } catch {
    return { peaks: {} };
  }
}

function saveForecastStore(store: ForecastStore): void {
  const file = forecastStateFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

function medianPeak(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

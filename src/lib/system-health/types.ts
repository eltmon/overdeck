export type HostPlatform = 'linux' | 'darwin' | 'unsupported';

export type HostMetricSignal<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: string };

export interface CpuCounters {
  idle: number;
  total: number;
}

export interface SwapCounters {
  pagesIn: number;
  pagesOut: number;
}

export interface HostCollectorCounters {
  cpu: CpuCounters | null;
  swap: SwapCounters | null;
}

export interface HostMetricSample {
  platform: HostPlatform;
  sampledAtMs: number;
  cpuPercent: HostMetricSignal<number>;
  loadAverage1m: HostMetricSignal<number>;
  loadPerCore1m: HostMetricSignal<number>;
  totalMemoryBytes: HostMetricSignal<number>;
  usedMemoryBytes: HostMetricSignal<number>;
  availableMemoryBytes: HostMetricSignal<number>;
  memoryUsedPercent: HostMetricSignal<number>;
  memoryPressureSomeAvg10: HostMetricSignal<number>;
  memoryPressureFullAvg10: HostMetricSignal<number>;
  memoryPressureFreePercent: HostMetricSignal<number>;
  swapTotalBytes: HostMetricSignal<number>;
  swapUsedBytes: HostMetricSignal<number>;
  swapUsedPercent: HostMetricSignal<number>;
  swapActivityBytesPerMinute: HostMetricSignal<number>;
  committedMemoryBytes: HostMetricSignal<number>;
  commitLimitBytes: HostMetricSignal<number>;
  virtualCommitmentPercent: HostMetricSignal<number>;
  counters: HostCollectorCounters;
}

export interface HostHealthCollector {
  readonly platform: HostPlatform;
  sample(previous?: HostMetricSample): Promise<HostMetricSample>;
}

export function available<T>(value: T): HostMetricSignal<T> {
  return { status: 'available', value };
}

export function unavailable<T = number>(reason: string): HostMetricSignal<T> {
  return { status: 'unavailable', reason };
}

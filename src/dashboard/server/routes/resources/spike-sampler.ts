import { emitActivityEntrySync, type EmitActivityOptions } from '../../../../lib/activity-logger.js';

export interface ResourceProcessGroup {
  label: string;
  cpuPercent: number;
  count?: number;
  agentId?: string;
  issueId?: string;
  command?: string;
  pids?: number[];
}

export interface ResourceSpikeSample {
  cpuPercent: number;
  load1: number;
  cores: number;
  processGroups: ResourceProcessGroup[];
  timestamp?: string;
}

export interface ResourceSpikeDetails {
  category: 'resources';
  targetKind: 'host-process';
  targetId: string;
  attributedAgentId?: string;
  attributedIssueId?: string;
  cpuPercent: number;
  load1: number;
  cores: number;
  processGroups: ResourceProcessGroup[];
}

interface ResourceSpikeSamplerOptions {
  cpuThreshold?: number;
  loadPerCoreThreshold?: number;
  hysteresis?: number;
  recoveryTicks?: number;
  topProcessCount?: number;
  emit?: (entry: Omit<EmitActivityOptions, 'details'> & { details: ResourceSpikeDetails }) => void;
}

export interface ResourceSpikeSampler {
  sample(sample: ResourceSpikeSample): void;
  reset(): void;
}

const DEFAULT_CPU_THRESHOLD = 80;
const DEFAULT_LOAD_PER_CORE_THRESHOLD = 1.5;
const DEFAULT_HYSTERESIS = 10;
const DEFAULT_RECOVERY_TICKS = 2;
const DEFAULT_TOP_PROCESS_COUNT = 3;

function defaultEmit(entry: Omit<EmitActivityOptions, 'details'> & { details: ResourceSpikeDetails }) {
  emitActivityEntrySync(entry as unknown as EmitActivityOptions);
}

function topProcessGroups(groups: ResourceProcessGroup[], limit: number): ResourceProcessGroup[] {
  return [...groups]
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, limit);
}

function spikeMessage(sample: ResourceSpikeSample, topGroups: ResourceProcessGroup[], loadPerCoreThreshold: number): string {
  const metric = sample.load1 > sample.cores * loadPerCoreThreshold
    ? `Load ${sample.load1.toFixed(1)} spike`
    : `CPU ${Math.round(sample.cpuPercent)}% spike`;

  if (topGroups.length === 0) return `${metric} - no top process attribution available`;

  const culprit = topGroups
    .map((group) => {
      const count = group.count && group.count > 1 ? ` x${group.count}` : '';
      const owner = group.agentId ? ` (${group.agentId})` : group.issueId ? ` (${group.issueId})` : '';
      return `${group.label}${count}${owner}`;
    })
    .join(', ');

  return `${metric} - ${culprit}`;
}

function targetIdFor(group: ResourceProcessGroup | undefined): string {
  return group?.agentId ?? group?.issueId ?? group?.label ?? 'unattributed';
}

export function createResourceSpikeSampler(options: ResourceSpikeSamplerOptions = {}): ResourceSpikeSampler {
  const cpuThreshold = options.cpuThreshold ?? DEFAULT_CPU_THRESHOLD;
  const loadPerCoreThreshold = options.loadPerCoreThreshold ?? DEFAULT_LOAD_PER_CORE_THRESHOLD;
  const hysteresis = options.hysteresis ?? DEFAULT_HYSTERESIS;
  const recoveryTicks = options.recoveryTicks ?? DEFAULT_RECOVERY_TICKS;
  const topProcessCount = options.topProcessCount ?? DEFAULT_TOP_PROCESS_COUNT;
  const emit = options.emit ?? defaultEmit;

  let inEpisode = false;
  let belowRecoveryTicks = 0;

  function isSpiking(sample: ResourceSpikeSample): boolean {
    return sample.cpuPercent > cpuThreshold || sample.load1 > sample.cores * loadPerCoreThreshold;
  }

  function isRecovered(sample: ResourceSpikeSample): boolean {
    const loadRecoveryThreshold = sample.cores * Math.max(0, loadPerCoreThreshold - 0.25);
    return sample.cpuPercent < cpuThreshold - hysteresis
      && sample.load1 < loadRecoveryThreshold;
  }

  return {
    sample(sample: ResourceSpikeSample) {
      if (isSpiking(sample)) {
        belowRecoveryTicks = 0;
        if (inEpisode) return;

        inEpisode = true;
        const topGroups = topProcessGroups(sample.processGroups, topProcessCount);
        const topGroup = topGroups[0];

        emit({
          source: 'dashboard',
          level: 'warn',
          message: spikeMessage(sample, topGroups, loadPerCoreThreshold),
          issueId: topGroup?.issueId,
          link: '/resources',
          details: {
            category: 'resources',
            targetKind: 'host-process',
            targetId: targetIdFor(topGroup),
            attributedAgentId: topGroup?.agentId,
            attributedIssueId: topGroup?.issueId,
            cpuPercent: sample.cpuPercent,
            load1: sample.load1,
            cores: sample.cores,
            processGroups: topGroups,
          },
        });
        return;
      }

      if (!inEpisode) return;

      if (isRecovered(sample)) {
        belowRecoveryTicks += 1;
        if (belowRecoveryTicks >= recoveryTicks) {
          inEpisode = false;
          belowRecoveryTicks = 0;
        }
      } else {
        belowRecoveryTicks = 0;
      }
    },
    reset() {
      inEpisode = false;
      belowRecoveryTicks = 0;
    },
  };
}

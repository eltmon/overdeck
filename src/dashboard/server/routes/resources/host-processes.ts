export interface HostProcessRecord {
  pid: number;
  ppid: number;
  command: string;
  cpuPercent: number;
  memoryBytes: number;
  cgroup?: string | null;
}

export interface AgentSessionProcess {
  agentId: string;
  rootPid: number;
  issueId?: string;
}

export interface SpikeAnnotation {
  label: string;
  targetId?: string;
  ts?: string;
}

export interface HostProcessesOptions {
  agentSessions?: AgentSessionProcess[];
  coreServicePids?: Iterable<number>;
  nowMs?: number;
  limit?: number;
  burstCpuThreshold?: number;
  burstRetentionMs?: number;
  spikeAnnotations?: SpikeAnnotation[];
}

export interface HostProcessOwner {
  label: string;
  agentId?: string;
  issueId?: string;
}

export interface HostProcessRow {
  id: string;
  family: string;
  label: string;
  owner: HostProcessOwner;
  pidCount: number;
  pids: number[];
  cpuPercent: number;
  memoryBytes: number;
  peakCpuPercent: number;
  peakMemoryBytes: number;
  retainedUntil?: string;
  note?: string;
}

interface HostProcessGroup {
  id: string;
  family: string;
  label: string;
  owner: HostProcessOwner;
  pidCount: number;
  pids: number[];
  cpuPercent: number;
  memoryBytes: number;
}

interface RetainedBurst {
  row: HostProcessRow;
  lastSeenMs: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_BURST_CPU_THRESHOLD = 50;
const DEFAULT_BURST_RETENTION_MS = 60 * 60 * 1000;

const retainedBursts = new Map<string, RetainedBurst>();

export function resetHostProcessRetention(): void {
  retainedBursts.clear();
}

export function buildHostProcesses(
  processes: HostProcessRecord[],
  options: HostProcessesOptions = {},
): HostProcessRow[] {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const burstCpuThreshold = options.burstCpuThreshold ?? DEFAULT_BURST_CPU_THRESHOLD;
  const burstRetentionMs = options.burstRetentionMs ?? DEFAULT_BURST_RETENTION_MS;
  const coreServicePids = new Set(options.coreServicePids ?? []);
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const agentRootByPid = new Map(
    (options.agentSessions ?? []).map((session) => [session.rootPid, session]),
  );

  const groups = new Map<string, HostProcessGroup>();

  for (const process of processes) {
    if (coreServicePids.has(process.pid) || agentRootByPid.has(process.pid) || isDockerProcess(process)) {
      continue;
    }

    const family = classifyCommandFamily(process.command);
    const owner = resolveOwner(process, processByPid, agentRootByPid, family);
    const id = [
      family,
      owner.agentId ?? owner.label,
      owner.issueId ?? 'host',
    ].join(':');

    const existing = groups.get(id);
    if (existing) {
      existing.pidCount += 1;
      existing.pids.push(process.pid);
      existing.cpuPercent += process.cpuPercent;
      existing.memoryBytes += process.memoryBytes;
      continue;
    }

    groups.set(id, {
      id,
      family,
      label: family,
      owner,
      pidCount: 1,
      pids: [process.pid],
      cpuPercent: process.cpuPercent,
      memoryBytes: process.memoryBytes,
    });
  }

  const activeRows = [...groups.values()].map((group): HostProcessRow => {
    const retained = retainedBursts.get(group.id);
    const peakCpuPercent = Math.max(group.cpuPercent, retained?.row.peakCpuPercent ?? 0);
    const peakMemoryBytes = Math.max(group.memoryBytes, retained?.row.peakMemoryBytes ?? 0);
    const row: HostProcessRow = {
      ...group,
      pids: group.pids.sort((a, b) => a - b),
      cpuPercent: roundOneDecimal(group.cpuPercent),
      peakCpuPercent: roundOneDecimal(peakCpuPercent),
      peakMemoryBytes,
    };

    if (peakCpuPercent >= burstCpuThreshold) {
      retainedBursts.set(group.id, { row, lastSeenMs: nowMs });
    } else {
      retainedBursts.delete(group.id);
    }

    return row;
  });

  const activeGroupIds = new Set(activeRows.map((row) => row.id));
  const retainedRows: HostProcessRow[] = [];

  for (const [groupId, retained] of retainedBursts) {
    if (activeGroupIds.has(groupId)) continue;

    const retainedUntilMs = retained.lastSeenMs + burstRetentionMs;
    if (retainedUntilMs <= nowMs) {
      retainedBursts.delete(groupId);
      continue;
    }

    retainedRows.push({
      ...retained.row,
      cpuPercent: 0,
      memoryBytes: 0,
      retainedUntil: new Date(retainedUntilMs).toISOString(),
      note: buildRetainedBurstNote(retained.row, options.spikeAnnotations),
    });
  }

  return selectTopRows([...activeRows, ...retainedRows], limit);
}

export function getHostProcessesSnapshot(): HostProcessRow[] {
  return buildHostProcesses([]);
}

function isDockerProcess(process: HostProcessRecord): boolean {
  return /\b(docker|containerd|kubepods)\b/i.test(process.cgroup ?? '');
}

function classifyCommandFamily(command: string): string {
  const normalized = command.toLowerCase();
  if (normalized.includes('vitest')) return 'vitest workers';
  if (normalized.includes('chrome') || normalized.includes('chromium')) return 'chrome renderers';
  if (/\bmvn\b|maven/.test(normalized)) return 'mvn';
  if (/\bnode\b/.test(normalized)) return 'node';
  if (/\bbun\b/.test(normalized)) return 'bun';

  return command.trim().split(/\s+/)[0] || 'unknown';
}

function resolveOwner(
  process: HostProcessRecord,
  processByPid: Map<number, HostProcessRecord>,
  agentRootByPid: Map<number, AgentSessionProcess>,
  family: string,
): HostProcessOwner {
  if (family === 'chrome renderers') {
    return { label: 'your browser' };
  }

  let current: HostProcessRecord | undefined = process;
  const seenPids = new Set<number>();

  while (current && !seenPids.has(current.pid)) {
    seenPids.add(current.pid);
    const agentSession = agentRootByPid.get(current.pid);
    if (agentSession) {
      return {
        label: `spawned by ${agentSession.agentId}`,
        agentId: agentSession.agentId,
        issueId: agentSession.issueId,
      };
    }
    current = processByPid.get(current.ppid);
  }

  return { label: 'host' };
}

function buildRetainedBurstNote(
  row: HostProcessRow,
  annotations: SpikeAnnotation[] | undefined,
): string {
  const matchingAnnotation = annotations?.find((annotation) => {
    if (annotation.targetId && annotation.targetId === row.owner.agentId) return true;
    return annotation.label.includes(row.family) || annotation.label.includes(row.owner.label);
  });

  if (!matchingAnnotation) return 'caused spike';
  return `caused spike: ${matchingAnnotation.label}`;
}

function selectTopRows(rows: HostProcessRow[], limit: number): HostProcessRow[] {
  const topByCpu = [...rows]
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.peakCpuPercent - a.peakCpuPercent)
    .slice(0, limit);
  const topByMemory = [...rows]
    .sort((a, b) => b.memoryBytes - a.memoryBytes || b.peakMemoryBytes - a.peakMemoryBytes)
    .slice(0, limit);
  const merged = new Map<string, HostProcessRow>();

  for (const row of [...topByCpu, ...topByMemory]) {
    merged.set(row.id, row);
  }

  return [...merged.values()]
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.peakCpuPercent - a.peakCpuPercent)
    .slice(0, limit);
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

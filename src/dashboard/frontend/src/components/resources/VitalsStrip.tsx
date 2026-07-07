import type { HostVitalsSnapshot, SpawnGateSnapshot } from '../../types';
import { SpawnGateVital } from './SpawnGateVital';

interface VitalsStripProps {
  hostVitals?: HostVitalsSnapshot;
  spawnGate?: SpawnGateSnapshot;
}

export function VitalsStrip({ hostVitals, spawnGate }: VitalsStripProps) {
  const vitals = hostVitals ?? emptyHostVitals();
  const memTotal = vitals.mem.usedBytes + vitals.mem.availableBytes;
  const memPct = memTotal > 0 ? Math.round((vitals.mem.usedBytes / memTotal) * 100) : 0;
  const diskTotal = vitals.disk.usedBytes + vitals.disk.freeBytes;
  const diskPct = diskTotal > 0 ? Math.round((vitals.disk.usedBytes / diskTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-3 xl:grid-cols-6">
      <VitalsCell label="CPU" value={`${vitals.cpu.percent}%`} sub={`load ${vitals.cpu.load.join(' / ')}`}>
        <Sparkline values={vitals.cpu.spark} />
      </VitalsCell>
      <VitalsCell label="Memory" value={`${memPct}%`} sub={`${formatBytes(vitals.mem.availableBytes)} free`}>
        <PressureBar value={memPct} />
      </VitalsCell>
      <VitalsCell label="Disk" value={`${diskPct}%`} sub={`${formatBytes(vitals.disk.freeBytes)} free`}>
        <PressureBar value={diskPct} />
      </VitalsCell>
      <VitalsCell label="Docker" value={`${vitals.docker.running}/${vitals.docker.containers}`} sub={`${vitals.docker.stacks} stacks`} />
      <VitalsCell label="Agents" value={`${vitals.agents.active}/${vitals.agents.sessions}`} sub={`${vitals.agents.idleOver15m} idle`} />
      <SpawnGateVital spawnGate={spawnGate} />
    </div>
  );
}

function VitalsCell({ label, value, sub, children }: { label: string; value: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-24 bg-background px-4 py-3">
      <div className="font-['DM_Mono'] text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function PressureBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 bg-muted">
      <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const points = values.length > 0 ? values : [0];
  const width = 120;
  const height = 24;
  const max = Math.max(100, ...points);
  const polyline = points.map((value, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - (Math.max(0, value) / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg role="img" aria-label="CPU sparkline" viewBox={`0 0 ${width} ${height}`} className="h-6 w-full">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={polyline} />
    </svg>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

function emptyHostVitals(): HostVitalsSnapshot {
  return {
    stale: false,
    cpu: { percent: 0, load: [0, 0, 0], spark: [] },
    mem: { usedBytes: 0, availableBytes: 0, swapUsedBytes: 0, swapTotalBytes: 0 },
    disk: { usedBytes: 0, freeBytes: 0, reclaimableBytes: 0 },
    docker: { containers: 0, running: 0, stacks: 0, networks: 0, networkPool: { used: 0, total: 31 }, stale: false },
    agents: { sessions: 0, active: 0, idleOver15m: 0, burnUsdPerHour: 0, hypotheticalUsdPerHour: 0, totalUsd: 0 },
  };
}

import type { SpawnGateSnapshot } from '../../types';

interface SpawnGateVitalProps {
  spawnGate?: SpawnGateSnapshot;
}

export function SpawnGateVital({ spawnGate }: SpawnGateVitalProps) {
  const gate = spawnGate ?? {
    state: 'OPEN' as const,
    reason: 'ready for work',
    pressure: 12,
    warnings: [],
  };

  const tone = gate.state === 'BLOCKED'
    ? 'gate-blocked border-destructive text-destructive'
    : gate.state === 'SOFT'
      ? 'gate-soft border-amber-500 text-amber-700'
      : 'gate-open border-emerald-500 text-emerald-700';

  return (
    <div className={`min-h-24 border-l-2 bg-background px-4 py-3 ${tone}`} aria-label="Spawn gate">
      <div className="font-['DM_Mono'] text-[11px] uppercase text-muted-foreground">Spawn gate</div>
      <div className="mt-1 font-['Space_Grotesk'] text-2xl font-semibold">{gate.state}</div>
      <div className="truncate text-xs text-muted-foreground" title={gate.reason || 'ready for work'}>
        {gate.reason || 'ready for work'}
      </div>
      <div className="mt-2 h-1.5 bg-muted">
        <div className="h-full bg-current" style={{ width: `${Math.max(0, Math.min(100, gate.pressure))}%` }} />
      </div>
    </div>
  );
}

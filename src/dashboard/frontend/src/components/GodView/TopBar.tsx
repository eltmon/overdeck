import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { useGodViewStore } from '../../hooks/useGodViewSocket';
import type { Agent } from '../../types';

interface TopBarProps {
  agents: Agent[];
}

function SystemClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="gv-mono text-sm" style={{ color: 'var(--gv-blue)' }}>
      {now.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}

function HealthSparkline({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-end gap-0.5 h-6">
        {/* Simple bar representing current value */}
        <div
          className="w-12 rounded-sm transition-all duration-500"
          style={{
            height: `${Math.max(4, (value / 100) * 24)}px`,
            backgroundColor: color,
            opacity: 0.8,
          }}
        />
      </div>
      <span className="text-[10px]" style={{ color: 'var(--gv-text-secondary)' }}>
        {label} {Math.round(value)}%
      </span>
    </div>
  );
}

export function GodViewTopBar({ agents }: TopBarProps) {
  const systemHealth = useGodViewStore((s) => s.systemHealth);
  const activeCount = agents.filter((a) => a.status !== 'stopped' && a.status !== 'dead').length;


  return (
    <div
      className="gv-glass flex items-center gap-4 px-4 py-2 shrink-0 mx-3 mt-3 rounded-xl"
      style={{ borderColor: 'rgba(0, 212, 255, 0.2)' }}
    >
      {/* Logo with glow animation */}
      <div className="flex items-center gap-2 shrink-0">
        <Zap
          className="w-5 h-5"
          style={{
            color: 'var(--gv-blue)',
            animation: 'gv-logo-glow 3s ease-in-out infinite',
          }}
        />
        <span
          className="text-sm font-bold tracking-widest uppercase"
          style={{ color: 'var(--gv-blue)', fontFamily: 'var(--gv-font-display)' }}
        >
          God View
        </span>
      </div>

      <div className="w-px h-5 shrink-0" style={{ backgroundColor: 'var(--gv-border)' }} />

      {/* System Clock */}
      <SystemClock />

      <div className="w-px h-5 shrink-0" style={{ backgroundColor: 'var(--gv-border)' }} />

      {/* Health Sparklines */}
      {systemHealth && (
        <div className="flex items-center gap-3">
          <HealthSparkline label="CPU" value={systemHealth.cpu} color="var(--gv-blue)" />
          <HealthSparkline label="MEM" value={systemHealth.memPercent} color="var(--gv-purple)" />
        </div>
      )}

      <div className="flex-1" />

      {/* Active Agent Badge */}
      <div
        className="flex items-center gap-1.5 px-3 py-1 rounded-full"
        style={{
          background: 'rgba(57, 255, 20, 0.1)',
          border: '1px solid rgba(57, 255, 20, 0.3)',
          animation: activeCount > 0 ? 'gv-pulse 2s ease-in-out infinite' : 'none',
        }}
      >
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: activeCount > 0 ? 'var(--gv-green)' : 'var(--gv-text-dim)' }}
        />
        <span
          className="text-xs font-semibold gv-mono"
          style={{ color: activeCount > 0 ? 'var(--gv-green)' : 'var(--gv-text-secondary)' }}
        >
          {activeCount} active
        </span>
      </div>

      {/* Total agents count */}
      <div className="text-xs" style={{ color: 'var(--gv-text-secondary)' }}>
        {agents.length} total agents
      </div>
    </div>
  );
}

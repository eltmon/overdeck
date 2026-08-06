import { Group } from '@visx/group';
import { Arc } from '@visx/shape';
import { useGodViewStore } from '../../hooks/useGodViewSocket';

interface GaugeProps {
  label: string;
  value: number | null; // 0-100
  color: string;
  size?: number;
}

function Gauge({ label, value, color, size = 62 }: GaugeProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = cx - 4;
  const innerRadius = outerRadius - 8;

  const startAngle = -Math.PI * 0.75;
  const endAngle = Math.PI * 0.75;
  const bounded = value == null ? 0 : Math.max(0, Math.min(100, value));
  const valueAngle = startAngle + (bounded / 100) * (endAngle - startAngle);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size * 0.7} overflow="visible">
        <Group top={cy} left={cx}>
          {/* Background arc */}
          <Arc
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            startAngle={startAngle}
            endAngle={endAngle}
            fill="rgba(255,255,255,0.06)"
          />
          {/* Value arc */}
          <Arc
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            startAngle={startAngle}
            endAngle={valueAngle}
            fill={color}
            opacity={0.85}
          />
          {/* Center value */}
          <text
            textAnchor="middle"
            dy="0.35em"
            fontSize={13}
            fontWeight="bold"
            fill={color}
            fontFamily="var(--gv-font-mono)"
          >
            {value == null ? '—' : `${Math.round(value)}%`}
          </text>
        </Group>
      </svg>
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--gv-text-secondary)' }}>
        {label}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

export function InfraGauges() {
  const systemHealth = useGodViewStore((s) => s.systemHealth);

  return (
    <div className="flex flex-col gap-2">
      <h3
        className="text-xs font-bold uppercase tracking-widest px-1"
        style={{ color: 'var(--gv-text-secondary)' }}
      >
        System
      </h3>
      <div className="flex justify-around gap-1">
        <Gauge label="CPU" value={systemHealth?.cpu ?? null} color="var(--gv-blue)" />
        <Gauge label="MEM" value={systemHealth?.memPercent ?? null} color="var(--gv-purple)" />
        <Gauge label="SWAP" value={systemHealth?.summary.swapUsedPercent ?? null} color="var(--gv-amber)" />
      </div>
      <div className="flex justify-between px-1">
        <span className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>
          Used: {systemHealth ? formatBytes(systemHealth.memUsed) : '—'}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>
          Total: {systemHealth ? formatBytes(systemHealth.memTotal) : '—'}
        </span>
      </div>
    </div>
  );
}

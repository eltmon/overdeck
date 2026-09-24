import { Group } from '@visx/group';
import { Arc } from '@visx/shape';
import { useGodViewStore } from '../../hooks/useGodViewSocket';
import { describeMemoryPressure, readMemoryPressure, type MemoryPressureLevel } from './confluence/memoryPressure';

interface GaugeProps {
  label: string;
  value: number | null;
  color: string;
  size?: number;
  /** The value that fills the arc; defaults to 100 (a percentage). */
  max?: number;
  /** Center text; defaults to a rounded percentage. */
  format?: (value: number) => string;
}

function Gauge({ label, value, color, size = 62, max = 100, format = (v) => `${Math.round(v)}%` }: GaugeProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = cx - 4;
  const innerRadius = outerRadius - 8;

  const startAngle = -Math.PI * 0.75;
  const endAngle = Math.PI * 0.75;
  const bounded = value == null ? 0 : Math.max(0, Math.min(max, value));
  const valueAngle = startAngle + (bounded / max) * (endAngle - startAngle);

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
            {value == null ? '—' : format(value)}
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

/** PSI `some` avg10 that fills the arc: the 5% warning band sits at half-scale. */
const PSI_GAUGE_MAX = 10;

const PRESSURE_COLOR: Record<MemoryPressureLevel, string> = {
  calm: 'var(--gv-blue)',
  unknown: 'var(--gv-text-secondary)',
  warning: 'var(--gv-amber)',
  critical: 'var(--gv-pink)',
};

export function InfraGauges() {
  const systemHealth = useGodViewStore((s) => s.systemHealth);
  const pressure = readMemoryPressure(systemHealth);

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
        {/* PAN-3540: memory distress is PSI + swap in/out, never swap occupancy. */}
        <span title={describeMemoryPressure(pressure)} data-testid="gv-psi-gauge" data-level={pressure.level}>
          <Gauge
            label="PSI"
            value={pressure.someAvg10}
            color={PRESSURE_COLOR[pressure.level]}
            max={PSI_GAUGE_MAX}
            format={(value) => value.toFixed(1)}
          />
        </span>
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

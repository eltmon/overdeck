import { Group } from '@visx/group';
import { Arc } from '@visx/shape';
import { scaleOrdinal } from '@visx/scale';
import type { Agent } from '../../types';

interface CostDonutProps {
  agents: Agent[];
  width?: number;
  height?: number;
}

export function CostDonut({ agents, width = 120, height = 120 }: CostDonutProps) {
  const activeAgents = agents.filter((a) => a.status !== 'stopped' && a.status !== 'dead');

  // PAN-1048: group by role (replaces legacy phase-based donut segments).
  const roleCounts: Record<string, number> = {};
  for (const agent of activeAgents) {
    const role = agent.role || 'other';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  const data = Object.entries(roleCounts).map(([label, value]) => ({ label, value }));
  const total = data.reduce((s, d) => s + d.value, 0);

  const colors = ['var(--gv-blue)', 'var(--gv-green)', 'var(--gv-amber)', 'var(--gv-pink)', 'var(--gv-purple)'];
  const colorScale = scaleOrdinal({
    domain: data.map((d) => d.label),
    range: colors,
  });

  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = Math.min(cx, cy) - 6;
  const innerRadius = outerRadius * 0.6;

  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width, height, border: '2px solid var(--gv-border)' }}
      >
        <span className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>idle</span>
      </div>
    );
  }

  // Build arc segments
  let startAngle = -Math.PI / 2;
  const segments = data.map((d) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const seg = { ...d, startAngle, endAngle: startAngle + angle };
    startAngle += angle;
    return seg;
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={width} height={height}>
        <Group top={cy} left={cx}>
          {segments.map((seg) => (
            <Arc
              key={seg.label}
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              startAngle={seg.startAngle}
              endAngle={seg.endAngle}
              fill={colorScale(seg.label)}
              stroke="var(--gv-bg)"
              strokeWidth={2}
              opacity={0.85}
            />
          ))}
          {/* Center label */}
          <text
            textAnchor="middle"
            dy="0.4em"
            fontSize={18}
            fontWeight="bold"
            fill="var(--gv-text-primary)"
            fontFamily="var(--gv-font-mono)"
          >
            {total}
          </text>
          <text
            textAnchor="middle"
            dy="1.8em"
            fontSize={10}
            fill="var(--gv-text-secondary)"
            fontFamily="var(--gv-font-display)"
          >
            agents
          </text>
        </Group>
      </svg>
      {/* Legend */}
      <div className="flex flex-col gap-0.5 w-full">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: colorScale(seg.label) }}
            />
            <span className="text-[10px] truncate" style={{ color: 'var(--gv-text-secondary)' }}>
              {seg.label}
            </span>
            <span className="text-[10px] gv-mono ml-auto" style={{ color: 'var(--gv-text-dim)' }}>
              {seg.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

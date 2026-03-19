import { useEffect, useRef } from 'react';
import type { Agent } from '../../types';

interface ConnectionLinesProps {
  agents: Agent[];
  gridRef: React.RefObject<HTMLDivElement>;
}

/**
 * SVG overlay rendering connection lines between related agents (same issue family).
 * Lines connect agents sharing the same issueId prefix (e.g., PAN-341).
 * Uses ResizeObserver to recalculate positions on layout changes.
 */
export function ConnectionLines({ agents, gridRef }: ConnectionLinesProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const draw = () => {
      const svg = svgRef.current;
      const grid = gridRef.current;
      if (!svg || !grid) return;

      const gridRect = grid.getBoundingClientRect();
      svg.setAttribute('width', String(gridRect.width));
      svg.setAttribute('height', String(gridRect.height));

      // Clear existing lines
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // Group agents by issue prefix (e.g., "PAN" from "PAN-341")
      const groups = new Map<string, Agent[]>();
      for (const agent of agents) {
        if (!agent.issueId) continue;
        const prefix = agent.issueId.replace(/-\d+$/, '');
        const group = groups.get(prefix) || [];
        group.push(agent);
        groups.set(prefix, group);
      }

      // For each group with >1 agent, draw lines between card centers
      for (const [, group] of groups) {
        if (group.length < 2) continue;

        const positions: Array<{ x: number; y: number }> = [];
        for (const agent of group) {
          const card = grid.querySelector(`[data-agent-id="${agent.id}"]`);
          if (!card) continue;
          const rect = card.getBoundingClientRect();
          positions.push({
            x: rect.left - gridRect.left + rect.width / 2,
            y: rect.top - gridRect.top + rect.height / 2,
          });
        }

        // Draw dashed lines connecting consecutive agents in the group
        for (let i = 0; i < positions.length - 1; i++) {
          const a = positions[i];
          const b = positions[i + 1];
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(a.x));
          line.setAttribute('y1', String(a.y));
          line.setAttribute('x2', String(b.x));
          line.setAttribute('y2', String(b.y));
          line.setAttribute('stroke', 'rgba(0, 212, 255, 0.25)');
          line.setAttribute('stroke-width', '1');
          line.setAttribute('stroke-dasharray', '4 6');
          svg.appendChild(line);
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (gridRef.current) observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [agents, gridRef]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    />
  );
}

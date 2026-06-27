import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentType, CSSProperties } from 'react';
import { BacklogDAG, type SequenceResponse } from '../BacklogDAG';

vi.mock('reactflow/dist/style.css', () => ({}));

vi.mock('@dagrejs/dagre', () => ({
  default: {
    graphlib: {
      Graph: class {
        setGraph() {}
        setDefaultEdgeLabel() {}
        setNode() {}
        setEdge() {}
        node() { return { x: 100, y: 100 }; }
      },
    },
    layout: () => {},
  },
}));

vi.mock('reactflow', () => ({
  default: ({ nodes, edges, nodeTypes }: { nodes: Array<{ id: string; type?: string; data: unknown }>; edges: Array<{ id: string; style?: CSSProperties }>; nodeTypes: Record<string, ComponentType<{ data: unknown }>> }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type ?? ''];
        return NodeComponent ? <NodeComponent key={node.id} data={node.data} /> : null;
      })}
      {edges.map((edge) => (
        <div
          key={edge.id}
          data-testid={`edge-${edge.id}`}
          data-stroke={String(edge.style?.stroke ?? '')}
          data-stroke-width={String(edge.style?.strokeWidth ?? '')}
          data-stroke-dasharray={String(edge.style?.strokeDasharray ?? '')}
        />
      ))}
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Top: 'top', Bottom: 'bottom' },
  useNodesState: (nodes: unknown[]) => [nodes, vi.fn(), vi.fn()],
  useEdgesState: (edges: unknown[]) => [edges, vi.fn(), vi.fn()],
}));

function node(issueId: string, over: Partial<SequenceResponse['nodes'][number]> = {}): SequenceResponse['nodes'][number] {
  return {
    issueId,
    title: issueId,
    rank: 1,
    size: 'M',
    importance: 'medium',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: '',
    gate: 'auto',
    planning: 'auto',
    inPipeline: false,
    ...over,
  };
}

describe('BacklogDAG epic rendering', () => {
  it('renders an epic node with an EPIC chip and a contains edge with membership styling', () => {
    const data: SequenceResponse = {
      nodes: [
        node('PAN-2075', { isEpic: true, rank: 1 }),
        node('PAN-2076', { rank: 2 }),
      ],
      edges: [
        { from: 'PAN-2075', to: 'PAN-2076', type: 'contains' },
      ],
    };

    const { container } = render(<BacklogDAG data={data} />);

    expect(screen.getByText('EPIC')).toBeTruthy();
    expect(container.querySelector('.node.epic')).toBeTruthy();
    const edge = screen.getByTestId('edge-e-0-PAN-2075-PAN-2076');
    expect(edge.getAttribute('data-stroke')).toContain('var(--primary)');
    expect(edge.getAttribute('data-stroke-width')).toBe('1.2');
    expect(edge.getAttribute('data-stroke-dasharray')).toBe('2 5');
  });
});

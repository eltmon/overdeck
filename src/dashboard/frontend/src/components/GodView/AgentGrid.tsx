import { useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AgentCard } from './AgentCard';
import { ConnectionLines } from './ConnectionLines';
import type { Agent } from '../../types';

interface AgentGridProps {
  agents: Agent[];
  onSelectAgent: (agentId: string) => void;
}

export function AgentGrid({ agents, onSelectAgent }: AgentGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div
            className="text-5xl mb-4 font-bold"
            style={{ color: 'var(--gv-text-dim)', fontFamily: 'var(--gv-font-mono)' }}
          >
            [ ]
          </div>
          <div className="text-sm" style={{ color: 'var(--gv-text-secondary)' }}>
            No active agents
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--gv-text-dim)' }}>
            Start an agent to see it here
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3 relative">
      <div
        ref={gridRef}
        className="relative"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '12px',
          alignContent: 'start',
        }}
      >
        {/* SVG connection lines overlay */}
        <ConnectionLines agents={agents} gridRef={gridRef as React.RefObject<HTMLDivElement>} />

        <AnimatePresence>
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => onSelectAgent(agent.id)}
              data-agent-id={agent.id}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

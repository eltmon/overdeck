import * as React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { CanvasTerminal } from './CanvasTerminal';
import { BeadsKanban } from './BeadsKanban';
import { FileActivityTree } from './FileActivityTree';
import { AgentTimeline } from './AgentTimeline';
import { ActionBar } from './ActionBar';
import { useDashboardStore, selectAgentOutput, selectAgentById } from '../../lib/store';
import type { Agent } from '../../types';

interface FocusViewProps {
  agent: Agent;
  onClose: () => void;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: 'var(--gv-text-dim)' }}>
        {label}
      </span>
      <span className="text-xs gv-mono truncate" style={{ color: 'var(--gv-text-secondary)' }}>
        {value}
      </span>
    </div>
  );
}

export function AgentFocusView({ agent, onClose }: FocusViewProps) {
  const terminalLines = useDashboardStore(selectAgentOutput(agent.id));
  const liveAgent = useDashboardStore(selectAgentById(agent.id));
  const liveStatus = liveAgent?.status ?? agent.status;

  const statusColor: Record<string, string> = {
    healthy: 'var(--gv-green)',
    warning: 'var(--gv-amber)',
    stuck: 'var(--gv-pink)',
    dead: 'var(--gv-text-dim)',
    stopped: 'var(--gv-text-dim)',
    running: 'var(--gv-green)',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(10, 14, 26, 0.85)', backdropFilter: 'blur(8px)' }}
      onClick={(e: React.MouseEvent) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="gv-glass flex flex-col gap-4 p-5 relative"
        style={{
          width: 'min(900px, 95vw)',
          maxHeight: '90vh',
          overflow: 'hidden',
          borderColor: (statusColor[liveStatus] || 'var(--gv-border)') + '44',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-lg font-bold gv-mono"
                  style={{ color: 'var(--gv-blue)' }}
                >
                  {agent.issueId || agent.id}
                </span>
                <span
                  className="gv-status-pill"
                  style={{ background: statusColor[liveStatus] + '22', color: statusColor[liveStatus] }}
                >
                  {liveStatus}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <InfoRow label="Model" value={agent.model || 'unknown'} />
                {agent.git?.branch && <InfoRow label="Plan" value={agent.git.branch} />}
                {agent.role && <InfoRow label="Role" value={agent.role} />}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'var(--gv-text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left: terminal + beads + actions */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            {/* Large canvas terminal (30 lines) */}
            <div className="shrink-0">
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gv-text-dim)' }}>
                Terminal
              </div>
              <CanvasTerminal lines={terminalLines} rows={12} fontSize={11} className="rounded-lg" />
            </div>

            {/* Beads kanban */}
            <div className="shrink-0">
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gv-text-dim)' }}>
                Tasks
              </div>
              <BeadsKanban agentId={agent.id} workspace={agent.workspace} />
            </div>

            {/* Action bar */}
            <div className="mt-auto shrink-0">
              <ActionBar agent={agent} onClose={onClose} />
            </div>
          </div>

          {/* Right: files + timeline */}
          <div
            className="flex flex-col gap-3 overflow-y-auto"
            style={{ width: 220, flexShrink: 0 }}
          >
            {/* File activity tree */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gv-text-dim)' }}>
                Changed Files
              </div>
              <FileActivityTree agentId={agent.id} />
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--gv-border)' }} />

            {/* Timeline */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gv-text-dim)' }}>
                Timeline
              </div>
              <AgentTimeline agentId={agent.id} />
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

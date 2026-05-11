import { useEffect, useState } from 'react';
import { useSharedTick } from '../../lib/useSharedTick';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { motion } from 'framer-motion';
import { Clock, GitBranch, Cpu, AlertTriangle, CheckCircle, XCircle, Minus, Radio } from 'lucide-react';
import { CanvasTerminal } from './CanvasTerminal';
import { selectGodViewAgentOutput, selectGodViewAgentStatuses } from '../../hooks/useGodViewSocket';
import { useDashboardStore } from '../../lib/store';
import type { Agent } from '../../types';

interface AgentCardProps {
  agent: Agent;
  onClick: () => void;
  'data-agent-id'?: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  healthy: <CheckCircle className="w-3 h-3" />,
  warning: <AlertTriangle className="w-3 h-3" />,
  stuck: <AlertTriangle className="w-3 h-3" />,
  dead: <XCircle className="w-3 h-3" />,
  stopped: <Minus className="w-3 h-3" />,
  running: <CheckCircle className="w-3 h-3" />,
};

const STATUS_GLOW: Record<string, string> = {
  healthy: 'gv-breathe-healthy',
  warning: 'gv-breathe-warning',
  stuck: 'gv-breathe-stuck',
  dead: 'gv-breathe-dead',
  stopped: 'gv-breathe-dead',
  running: 'gv-breathe-healthy',
};

// PAN-1048: colors are now keyed by Role, not legacy phase strings.
const ROLE_COLORS: Record<string, string> = {
  plan: 'var(--gv-amber)',
  work: 'var(--gv-blue)',
  review: 'var(--gv-purple)',
  test: 'var(--gv-green)',
  ship: 'var(--gv-orange)',
};

function UptimeCounter({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const update = () => {
      const ms = Date.now() - new Date(startedAt).getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setElapsed(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return <span className="gv-mono text-[10px]" style={{ color: 'var(--gv-text-secondary)' }}>{elapsed}</span>;
}

function stalenessColor(ms: number): string {
  if (ms < 2 * 60_000) return 'var(--gv-green)';
  if (ms < 10 * 60_000) return 'var(--gv-amber)';
  if (ms < 30 * 60_000) return 'var(--gv-orange)';
  return 'var(--gv-pink)';
}

function LastHeardCounter({ lastActivity }: { lastActivity?: string }) {
  const now = useSharedTick();
  if (!lastActivity) return null;
  const ms = now.getTime() - new Date(lastActivity).getTime();
  if (ms < 1000) return null;
  const label = formatRelativeTime(lastActivity, now);
  return (
    <span className="gv-mono text-[10px]" style={{ color: stalenessColor(ms) }}>
      {label}
    </span>
  );
}

export function AgentCard({ agent, onClick, 'data-agent-id': dataAgentId }: AgentCardProps) {
  const agentOutput = useDashboardStore(selectGodViewAgentOutput);
  const agentStatuses = useDashboardStore(selectGodViewAgentStatuses);
  const terminalLines = agentOutput[agent.id] || [];
  const liveStatus = agentStatuses[agent.id] || agent.status;

  const roleColor = agent.role ? ROLE_COLORS[agent.role] || 'var(--gv-blue)' : 'var(--gv-blue)';

  const now = useSharedTick();
  const lastHeardTooltip = (() => {
    if (!agent.lastActivity) return '';
    const ms = now.getTime() - new Date(agent.lastActivity).getTime();
    if (ms < 1000) return '';
    return `Last heard: ${formatRelativeTime(agent.lastActivity, now)}`;
  })();
  const cardTooltip = [
    agent.issueId || agent.id,
    agent.role ? `Role: ${agent.role}` : '',
    lastHeardTooltip,
  ].filter(Boolean).join(' · ');

  return (
    <motion.div
      data-agent-id={dataAgentId || agent.id}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      title={cardTooltip}
      className={`gv-glass cursor-pointer p-3 flex flex-col gap-2 relative overflow-hidden ${STATUS_GLOW[liveStatus] || ''}`}
      style={{ borderColor: roleColor + '44' }}
    >
      {/* Project color border accent (left) */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ backgroundColor: roleColor }}
      />

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 pl-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-xs font-bold truncate"
            style={{ color: roleColor, fontFamily: 'var(--gv-font-mono)' }}
          >
            {agent.issueId || agent.id}
          </span>
          {agent.role && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-medium uppercase"
              style={{ color: roleColor, background: roleColor + '22' }}
            >
              {agent.role}
            </span>
          )}
        </div>

        {/* Status pill */}
        <div className={`gv-status-pill ${liveStatus}`}>
          {STATUS_ICONS[liveStatus]}
          {liveStatus}
        </div>
      </div>

      {/* Canvas terminal preview */}
      <div className="pl-2">
        {terminalLines.length > 0 ? (
          <CanvasTerminal lines={terminalLines} rows={3} fontSize={10} />
        ) : (
          <div
            className="h-10 rounded flex items-center justify-center text-[10px]"
            style={{ background: 'var(--gv-surface)', color: 'var(--gv-text-dim)' }}
          >
            no output
          </div>
        )}
      </div>

      {/* Git branch */}
      {agent.git?.branch && (
        <div className="flex items-center gap-1 pl-2">
          <GitBranch className="w-3 h-3 shrink-0" style={{ color: 'var(--gv-text-dim)' }} />
          <span className="text-[10px] gv-mono text-content-subtle">Plan</span>
          <span className="text-[10px] gv-mono truncate" style={{ color: 'var(--gv-text-secondary)' }}>
            {agent.git.branch}
          </span>
        </div>
      )}

      {/* Bottom row: model, uptime, last heard */}
      <div className="flex items-center justify-between pl-2 mt-auto">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3" style={{ color: 'var(--gv-text-dim)' }} />
          <span className="text-[10px] gv-mono" style={{ color: 'var(--gv-text-dim)' }}>
            {agent.model?.replace('claude-', '').replace('-20251022', '').replace('-20250514', '') || 'unknown'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" style={{ color: 'var(--gv-text-dim)' }} />
            <UptimeCounter startedAt={agent.startedAt} />
          </div>
          {agent.lastActivity && (
            <div className="flex items-center gap-1" title={lastHeardTooltip}>
              <Radio className="w-3 h-3" style={{ color: 'var(--gv-text-dim)' }} />
              <LastHeardCounter lastActivity={agent.lastActivity} />
            </div>
          )}
        </div>
      </div>

      {/* Pending question indicator */}
      {agent.hasPendingQuestion && (
        <div
          className="absolute top-1 right-1 w-2 h-2 rounded-full"
          style={{ backgroundColor: 'var(--gv-amber)', animation: 'gv-pulse 1s ease-in-out infinite' }}
          title="Agent needs input"
        />
      )}
    </motion.div>
  );
}

import { useState } from 'react';
import { getHarness } from '@overdeck/contracts';
import type { AgentSnapshot } from '@overdeck/contracts';

import { AgentTellForm } from '../AgentTellForm';
import VerbBadge, { type VerbBadgeProps } from '../primitives/VerbBadge';
import { getFriendlyModelName } from '../../lib/dashboard-utils';
import { isAwaitingInput } from '../../lib/pendingInput';
import {
  useDashboardStore,
  selectAgentById,
  selectAgentOutput,
  selectPendingPermissionAgentIds,
} from '../../lib/store';
import { cn } from '../../lib/utils';
import { ACTIVE_AGENT_PANEL_SECTIONS } from './inventory';

export type StreamLineKind = 'verb-line' | 'ok' | 'warn' | 'err' | 'neutral';

const STREAM_LINE_COLOR_CLASS: Record<StreamLineKind, string> = {
  'verb-line': 'text-signal-review-foreground',
  ok: 'text-success-foreground',
  warn: 'text-warning-foreground',
  err: 'text-destructive-foreground',
  neutral: 'text-foreground',
};

/**
 * Classify a stream line for color routing per PRD §4.7 stream excerpt rules.
 * Priority: err > warn > ok > verb-line > neutral.
 */
export function classifyStreamLine(line: string): StreamLineKind {
  if (/^[✗❌]\s*|\bERR\b|\bERROR\b|\bFAIL\b/i.test(line)) return 'err';
  if (/^!\s*|\bWARN\b|\bWARNING\b/i.test(line)) return 'warn';
  if (/^✓\s*|\bOK\b|\bPASS\b|\bdone\b/i.test(line)) return 'ok';
  if (/^[→▸✱]/.test(line)) return 'verb-line';
  return 'neutral';
}

function stuckHours(agent: AgentSnapshot, now: Date): number {
  const since = agent.firstFailureInRunAt ?? agent.lastFailureAt ?? agent.lastActivity ?? agent.startedAt;
  if (!since) return 0;
  const sinceTime = new Date(since).getTime();
  if (Number.isNaN(sinceTime)) return 0;
  return Math.max(0, Math.floor((now.getTime() - sinceTime) / 3_600_000));
}

function isTerminalStatus(status: AgentSnapshot['status']): boolean {
  return status === 'error' || status === 'unknown';
}

function verbBadgeForAgent(
  agent: AgentSnapshot,
  pendingPermissionAgentIds?: ReadonlySet<string>,
): VerbBadgeProps {
  if (agent.troubled || isTerminalStatus(agent.status)) {
    return { variant: 'STUCK · Nh', hours: stuckHours(agent, new Date()), className: 'text-[9px]' };
  }
  if (isAwaitingInput(agent, pendingPermissionAgentIds)) return { variant: 'INPUT', className: 'text-[9px]' };
  if (agent.status === 'stopped') return { variant: 'STOPPED', className: 'text-[9px]' };
  if (agent.role === 'plan') return { variant: 'PLANNING', className: 'text-[9px]' };
  if (agent.role === 'review' || agent.role === 'test') return { variant: 'REVIEW RUNNING', className: 'text-[9px]' };
  if (agent.role === 'ship') return { variant: 'SHIP RUNNING', className: 'text-[9px]' };
  if (agent.role === 'strike') return { variant: 'STRIKE RUNNING', className: 'text-[9px]' };
  return { variant: 'WORK RUNNING', className: 'text-[9px]' };
}

function formatSpend(cost: number | undefined) {
  if (cost === undefined) return 'loading';
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(3)}`;
  return '$0';
}

export interface ActiveAgentPanelProps {
  agentId: string;
  density?: 'console' | 'cockpit' | 'rail';
  className?: string;
  title?: string;
}

export function ActiveAgentPanel({
  agentId,
  density = 'console',
  className,
  title,
}: ActiveAgentPanelProps) {
  const agent = useDashboardStore(selectAgentById(agentId));
  const pendingPermissionAgentIds = useDashboardStore(selectPendingPermissionAgentIds);
  const agentOutput = useDashboardStore(selectAgentOutput(agentId));
  const [sending, setSending] = useState(false);

  const sectionId = density === 'console' ? 'active-agent' : undefined;

  const fallback = (
    <section
      id={sectionId}
      data-testid="active-agent-panel"
      data-section={ACTIVE_AGENT_PANEL_SECTIONS[0]}
      className={cn(
        'rounded-[var(--radius)] border border-border bg-card p-[14px]',
        className,
      )}
    >
      <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {title ?? 'Active Agent'}
      </div>
      <div className="rounded-[10px] border border-border bg-background/45 px-[12px] py-[14px] text-[12px] text-muted-foreground">
        No active agent.
      </div>
    </section>
  );

  if (!agent || isTerminalStatus(agent.status)) {
    return fallback;
  }

  const streamLines = agentOutput.slice(-8);
  const meta = `${getFriendlyModelName(agent.model)} · ${getHarness(agent)} · spend ${formatSpend(agent.costSoFar)}`;
  const isEffectivelyLive = agent.status === 'running' || agent.status === 'starting';
  const maxHeightClass = density === 'rail' ? 'max-h-[120px]' : 'max-h-[180px]';

  const sendTell = async (text: string) => {
    if (sending) return false;

    setSending(true);
    try {
      // PAN-1985 follow-up: route through /resume for non-live agents so the
      // backend can re-attach to the saved session and deliver the message
      // in one round trip. /tell assumes a live tmux; for stopped agents
      // /tell 502s on the echo-confirm. /resume handles spawn-or-revive +
      // delivery internally.
      const endpoint = isEffectivelyLive
        ? `/api/agents/${agentId}/tell`
        : `/api/agents/${agentId}/resume`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.warn(`[active-agent-panel] send ${response.status} ${endpoint}: ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[active-agent-panel] send error:', error);
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendResume = async () => {
    if (sending) return false;
    setSending(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from active agent panel' }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.warn(`[active-agent-panel] resume ${response.status}: ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[active-agent-panel] resume error:', error);
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      id={sectionId}
      data-testid="active-agent-panel"
      data-section={ACTIVE_AGENT_PANEL_SECTIONS[0]}
      className={cn(
        'rounded-[var(--radius)] border border-border bg-card p-[14px]',
        density === 'console' && 'border-l-[3px] border-l-signal-review',
        className,
      )}
    >
      <div
        className="flex items-start justify-between gap-[12px]"
        data-section={ACTIVE_AGENT_PANEL_SECTIONS[1]}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-[8px]">
            <h3 className="truncate font-mono text-[13px] font-semibold leading-none text-foreground">
              {agent.id}
            </h3>
            <VerbBadge {...verbBadgeForAgent(agent, pendingPermissionAgentIds)} />
          </div>
          <div className="mt-[6px] text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {agent.status === 'stopped'
              ? 'Stopped Agent — send a message to resume'
              : (title ?? 'Active Agent')}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">
          {meta}
        </div>
      </div>

      <div
        data-testid="active-agent-panel-stream"
        data-section={ACTIVE_AGENT_PANEL_SECTIONS[2]}
        className={cn(
          'mt-[12px] overflow-auto rounded-[10px] border border-border bg-[rgb(0_0_0_/_32%)] px-[12px] py-[10px] font-mono text-[11px] leading-[16px]',
          maxHeightClass,
        )}
      >
        {streamLines.length > 0 ? (
          streamLines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              data-section={ACTIVE_AGENT_PANEL_SECTIONS[3]}
              className={cn('truncate', STREAM_LINE_COLOR_CLASS[classifyStreamLine(line)])}
            >
              {line}
            </div>
          ))
        ) : (
          <div className="italic text-muted-foreground">No recent stream output</div>
        )}
      </div>

      {!isEffectivelyLive && (
        <button
          type="button"
          data-testid="active-agent-panel-resume"
          data-section={ACTIVE_AGENT_PANEL_SECTIONS[4]}
          className="mt-[10px] w-full rounded-[var(--radius-sm)] border border-primary/30 bg-primary/10 px-[12px] py-[8px] text-[12px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void sendResume()}
          disabled={sending}
        >
          {sending ? 'Resuming…' : '▶ Resume agent'}
        </button>
      )}

      <div
        data-testid="active-agent-panel-tell"
        data-section={ACTIVE_AGENT_PANEL_SECTIONS[5]}
      >
        <AgentTellForm
          className="mt-[10px] flex gap-[8px]"
          sending={sending}
          onSend={sendTell}
          ariaLabel={`Tell ${agent.id}`}
          placeholder={isEffectivelyLive ? 'Tell this agent...' : 'Send a message to resume...'}
        />
      </div>
    </section>
  );
}

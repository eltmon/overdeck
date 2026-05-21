import { useState, type FormEvent } from 'react';
import { getHarness } from '@panctl/contracts';

import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';
import { getFriendlyModelName } from '../../lib/dashboard-utils';
import { isAgentProblemStatus } from '../../lib/pipeline-state';
import { useDashboardStore, selectAgentOutput } from '../../lib/store';
import VerbBadge, { type VerbBadgeProps } from '../primitives/VerbBadge';
import type { Agent } from '../../types';
import { useDrawerData } from './useDrawerData';

void COMMAND_DECK_SURFACE_REGISTRY;

function isActiveAgent(agent: Agent) {
  return agent.status !== 'stopped' && agent.status !== 'dead' && agent.status !== 'failed';
}

function stuckHours(agent: Agent, now: Date) {
  const since = agent.firstFailureInRunAt ?? agent.lastFailureAt ?? agent.lastActivity ?? agent.startedAt;
  if (!since) return 0;
  const sinceTime = new Date(since).getTime();
  if (Number.isNaN(sinceTime)) return 0;
  return Math.max(0, Math.floor((now.getTime() - sinceTime) / 3_600_000));
}

function verbBadgeForAgent(agent: Agent): VerbBadgeProps {
  if (isAgentProblemStatus(agent.status) || agent.troubled) {
    return { variant: 'STUCK · Nh', hours: stuckHours(agent, new Date()), className: 'text-[9px]' };
  }
  if (agent.hasPendingQuestion) return { variant: 'INPUT', className: 'text-[9px]' };
  if (agent.role === 'plan') return { variant: 'PLANNING', className: 'text-[9px]' };
  if (agent.role === 'review' || agent.role === 'test') return { variant: 'REVIEW RUNNING', className: 'text-[9px]' };
  if (agent.role === 'ship') return { variant: 'SHIP RUNNING', className: 'text-[9px]' };
  return { variant: 'WORK RUNNING', className: 'text-[9px]' };
}

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
  if (/^[✗❌]|\bERR\b|\bERROR\b|\bFAIL\b/i.test(line)) return 'err';
  if (/^!|\bWARN\b|\bWARNING\b/i.test(line)) return 'warn';
  if (/^✓|\bOK\b|\bPASS\b|\bdone\b/i.test(line)) return 'ok';
  if (/^[→▸✱]/.test(line)) return 'verb-line';
  return 'neutral';
}

function formatSpend(cost: number | undefined) {
  if (cost === undefined) return 'loading';
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(3)}`;
  return '$0';
}

export default function DrawerActiveAgent() {
  const { agents } = useDrawerData();
  const activeAgent = agents.find(isActiveAgent) ?? null;
  const agentOutput = useDashboardStore(
    activeAgent ? selectAgentOutput(activeAgent.id) : () => [],
  );
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!activeAgent) {
    return (
      <section id="active-agent" data-component="drawer-active-agent" data-testid="drawer-active-agent" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
        <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Active Agent</div>
        <div className="rounded-[10px] border border-border bg-background/45 px-[12px] py-[14px] text-[12px] text-muted-foreground">
          No active agent.
        </div>
      </section>
    );
  }

  const streamLines = agentOutput.slice(-8);
  const meta = `${getFriendlyModelName(activeAgent.model)} · ${getHarness(activeAgent)} · spend ${formatSpend(activeAgent.costSoFar)}`;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const response = await fetch(`/api/agents/${activeAgent.id}/tell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (response.ok) {
        setMessage('');
      } else {
        const body = await response.text();
        console.error('Tell failed:', body);
      }
    } catch (error) {
      console.error('Tell failed:', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="active-agent" data-component="drawer-active-agent" data-testid="drawer-active-agent" className="rounded-[var(--radius)] border border-border border-l-[3px] border-l-signal-review bg-card p-[14px]">
      <div className="flex items-start justify-between gap-[12px]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-[8px]">
            <h3 className="truncate font-mono text-[13px] font-semibold leading-none text-foreground">{activeAgent.id}</h3>
            <VerbBadge {...verbBadgeForAgent(activeAgent)} />
          </div>
          <div className="mt-[6px] text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Active Agent</div>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">{meta}</div>
      </div>

      <div data-testid="drawer-active-agent-stream" className="mt-[12px] max-h-[180px] overflow-auto rounded-[10px] border border-border bg-[rgb(0_0_0_/_32%)] px-[12px] py-[10px] font-mono text-[11px] leading-[16px]">
        {streamLines.length > 0 ? streamLines.map((line, index) => (
          <div key={`${line}-${index}`} className={`truncate ${STREAM_LINE_COLOR_CLASS[classifyStreamLine(line)]}`}>{line}</div>
        )) : <div className="italic text-muted-foreground">No recent stream output</div>}
      </div>

      <form className="mt-[12px] flex gap-[8px]" onSubmit={onSubmit}>
        <input
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell this agent..."
          aria-label="Tell active agent"
          className="h-[32px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-[10px] text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="h-[32px] rounded-[var(--radius-sm)] bg-primary px-[12px] text-[12px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

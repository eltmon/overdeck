import { useState } from 'react';
import { getHarness } from '@overdeck/contracts';

import { getFriendlyModelName } from '../../lib/dashboard-utils';
import { isAgentProblemStatus } from '../../lib/pipeline-state';
import { isAwaitingInput } from '../../lib/pendingInput';
import { useDashboardStore, selectAgentOutput } from '../../lib/store';
import VerbBadge, { type VerbBadgeProps } from '../primitives/VerbBadge';
import { AgentTellForm } from '../AgentTellForm';
import type { Agent } from '../../types';
import { useDrawerData } from './useDrawerData';

function isActiveAgent(agent: Agent) {
  // PAN-1985 follow-up: include stopped agents so the composer stays accessible
  // for re-engaging an agent that finished. The AgentTellForm's POST to
  // /api/agents/:id/tell routes through messageAgent() which auto-resumes
  // a stopped agent with the saved session id (PAN-367 / PAN-705) — so
  // typing a message and hitting send is the same one-step "resume + tell"
  // path that conversations use. Exclude terminal states (dead/failed)
  // because there's no recoverable session for those.
  if (agent.status === 'dead' || agent.status === 'failed') return false;
  return true;
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
  if (isAwaitingInput(agent)) return { variant: 'INPUT', className: 'text-[9px]' };
  if (agent.status === 'stopped') return { variant: 'STOPPED', className: 'text-[9px]' };
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

  const sendTell = async (text: string) => {
    if (sending) return false;

    setSending(true);
    try {
      // PAN-1985 follow-up: route through /resume for non-live agents so the
      // backend can re-attach to the saved session and deliver the message
      // in one round trip. /tell assumes a live tmux; for stopped/crashed
      // agents (work agent voluntarily stopped, review completed and
      // killed by specialists/done, etc.) /tell 502s on the echo-confirm.
      // /resume handles the spawn-or-revive + delivery internally and
      // returns a 200 with a delivery status.
      const isEffectivelyLive = activeAgent.status === 'running' || activeAgent.status === 'starting';
      const endpoint = isEffectivelyLive
        ? `/api/agents/${activeAgent.id}/tell`
        : `/api/agents/${activeAgent.id}/resume`;
      console.log(`[drawer/active-agent] send to ${activeAgent.id} status=${activeAgent.status} endpoint=${endpoint} messageLength=${text.length}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.warn(`[drawer/active-agent] send ${response.status} ${endpoint}: ${body.slice(0, 300)}`);
        return false;
      }
      const data = await response.json().catch(() => ({})) as { messageDelivered?: boolean; hint?: string };
      console.log(`[drawer/active-agent] send 200 ${endpoint}: messageDelivered=${data.messageDelivered}`);
      return true;
    } catch (error) {
      console.error('[drawer/active-agent] send error:', error);
      return false;
    } finally {
      setSending(false);
    }
  };

  // PAN-1985 follow-up: a dedicated Resume button for stopped agents. Sends
  // a default continue message via /resume so the operator doesn't have to
  // type a message just to wake the agent up. The backend's auto-resume
  // (PAN-367 / PAN-705) handles the rest. Shown only for non-live agents
  // where the composer would otherwise require a typed message.
  const isEffectivelyLive = activeAgent.status === 'running' || activeAgent.status === 'starting';
  const sendResume = async () => {
    if (sending) return false;
    setSending(true);
    try {
      console.log(`[drawer/active-agent] resume click for ${activeAgent.id} status=${activeAgent.status}`);
      const response = await fetch(`/api/agents/${activeAgent.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from drawer' }),
      });
      const data = await response.json().catch(() => ({})) as { messageDelivered?: boolean; hint?: string; error?: string };
      if (!response.ok) {
        console.warn(`[drawer/active-agent] resume ${response.status}: ${data.error ?? 'unknown error'}`);
        return false;
      }
      console.log(`[drawer/active-agent] resume 200: messageDelivered=${data.messageDelivered}`);
      return true;
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
          <div className="mt-[6px] text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {activeAgent.status === 'stopped' ? 'Stopped Agent — send a message to resume' : 'Active Agent'}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">{meta}</div>
      </div>

      <div data-testid="drawer-active-agent-stream" className="mt-[12px] max-h-[180px] overflow-auto rounded-[10px] border border-border bg-[rgb(0_0_0_/_32%)] px-[12px] py-[10px] font-mono text-[11px] leading-[16px]">
        {streamLines.length > 0 ? streamLines.map((line, index) => (
          <div key={`${line}-${index}`} className={`truncate ${STREAM_LINE_COLOR_CLASS[classifyStreamLine(line)]}`}>{line}</div>
        )) : <div className="italic text-muted-foreground">No recent stream output</div>}
      </div>

      {!isEffectivelyLive && (
        <button
          type="button"
          data-testid="drawer-resume-button"
          className="mt-[10px] w-full rounded-[var(--radius-sm)] border border-primary/30 bg-primary/10 px-[12px] py-[8px] text-[12px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void sendResume()}
          disabled={sending}
          title="Send a continue message to wake the agent. The backend will auto-resume the saved session and deliver the message in one round trip."
        >
          {sending ? 'Resuming…' : '▶ Resume agent'}
        </button>
      )}
      <AgentTellForm className="mt-[10px] flex gap-[8px]" sending={sending} onSend={sendTell} />
    </section>
  );
}

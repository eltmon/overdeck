import { useState } from 'react';

import { AgentTellForm } from '../AgentTellForm';
import { ACTIVE_AGENT_PANEL_SECTIONS } from './inventory';

export interface TellComposerProps {
  agentId: string;
  isEffectivelyLive: boolean;
  className?: string;
}

/** Shared tell surface for agent cards and the cockpit Session transcript. */
export function TellComposer({ agentId, isEffectivelyLive, className }: TellComposerProps) {
  const [sending, setSending] = useState(false);

  const sendTell = async (text: string) => {
    if (sending) return false;

    setSending(true);
    try {
      // PAN-1985: /tell requires a live tmux session. /resume revives a saved
      // session and delivers the message in the same round trip.
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
        console.warn(`[tell-composer] send ${response.status} ${endpoint}: ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[tell-composer] send error:', error);
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-testid="active-agent-panel-tell"
      data-section={ACTIVE_AGENT_PANEL_SECTIONS[3]}
      className={className}
    >
      <AgentTellForm
        className="mt-[10px] flex gap-[8px]"
        sending={sending}
        onSend={sendTell}
        ariaLabel={`Tell ${agentId}`}
        placeholder={isEffectivelyLive ? 'Tell this agent...' : 'Send a message to resume...'}
      />
    </div>
  );
}

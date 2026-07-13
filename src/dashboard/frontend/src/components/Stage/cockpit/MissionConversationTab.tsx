import type { ReactNode } from 'react';
import type { SessionNode } from '@overdeck/contracts';
import { ActiveAgentPanel } from '../../issue-view/ActiveAgentPanel';
import { CockpitCard } from './CockpitCard';

export interface MissionConversationTabProps {
  launcher: ReactNode;
  agentDock: ReactNode;
  actionDock: ReactNode;
  timeline: ReactNode;
  sessions?: readonly SessionNode[];
}

/** Conversation tab — the issue-scoped launch composition + timeline. */
export function MissionConversationTab({ launcher, agentDock, actionDock, timeline, sessions }: MissionConversationTabProps) {
  const activeSession = sessions?.find((s) => s.type === 'work' || s.type === 'strike');
  return (
    <div className="space-y-3.5">
      <CockpitCard tone="info" title="Launch">{launcher}</CockpitCard>
      {activeSession && (
        <ActiveAgentPanel agentId={activeSession.sessionId} density="cockpit" title="Active agent" />
      )}
      <div className="grid gap-3.5 xl:grid-cols-2">
        <CockpitCard tone="success" title="Agents">{agentDock}</CockpitCard>
        <CockpitCard tone="muted" title="Quick tools">{actionDock}</CockpitCard>
      </div>
      <CockpitCard tone="warning" title="Conversation timeline">{timeline}</CockpitCard>
    </div>
  );
}

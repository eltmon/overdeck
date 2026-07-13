import type { ReactNode } from 'react';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import { type Harness } from '../../shared/ModelPicker';
import { AgentStepRow, type AgentStepActionKind } from '../../issue-view/AgentStepRow';
import styles from '../styles/command-deck.module.css';

interface SessionNodeProps {
  session: SessionNodeType;
  issueId?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  /** PAN-1779: clear a persistent pause gate (POST /api/agents/:id/unpause). */
  onUnpauseSession?: (sessionId: string) => void;
  /** Muted summary text after the label (e.g. collapsed convoy verdict). */
  subtitle?: string;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onOpenPlanDialog?: (issueId: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function SessionNode({
  session,
  issueId,
  isSelected,
  onClick,
  onStopSession,
  onViewTerminal,
  onPauseSession,
  onResumeSession,
  onUnpauseSession,
  subtitle,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
  expandable,
  expanded,
  onToggleExpand,
}: SessionNodeProps) {
  const handleAction = (kind: AgentStepActionKind, payload?: { model?: string; harness?: Harness }) => {
    switch (kind) {
      case 'stop':
        onStopSession?.(session.sessionId);
        break;
      case 'pause':
        onPauseSession?.(session.sessionId);
        break;
      case 'resume':
        onResumeSession?.(session.sessionId);
        break;
      case 'unpause':
        onUnpauseSession?.(session.sessionId);
        break;
      case 'restart':
        if (issueId) {
          onRestartSession?.(session.sessionId, issueId, session.type, session.role, payload?.model, payload?.harness);
        }
        break;
      case 'deep-wipe':
        if (issueId) onDeepWipe?.(issueId);
        break;
      case 'open-state-dir':
        onOpenStateDir?.(session.sessionId);
        break;
      case 'view-jsonl':
        onViewJsonl?.(session.sessionId);
        break;
      case 'view-terminal':
        onViewTerminal?.(session.sessionId);
        break;
    }
  };

  return (
    <AgentStepRow
      session={session}
      issueId={issueId}
      density="rail"
      isSelected={isSelected}
      subtitle={subtitle}
      expandable={expandable}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      onClick={onClick}
      onAction={handleAction}
    />
  );
}

export function SessionChildList({ children }: { children: ReactNode }) {
  return <div className={styles.sessionChildList}>{children}</div>;
}

import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionNode } from '@overdeck/contracts';
import { clearTroubledGateForAgent } from '../../IssueActionMenu';
import { useAlert } from '../../DialogProvider';
import { getTroubledBadgeLabel, getTroubledBadgeTitle } from './troubledBadge';
import styles from '../styles/command-deck.module.css';

interface TroubledBadgesProps {
  sessions: readonly SessionNode[];
}

export function TroubledBadges({ sessions }: TroubledBadgesProps) {
  const queryClient = useQueryClient();
  const alert = useAlert();
  const handleClearTroubled = useCallback((event: MouseEvent, sessionId: string) => {
    event.stopPropagation();
    void clearTroubledGateForAgent(sessionId, queryClient, alert).catch(() => undefined);
  }, [alert, queryClient]);

  if (sessions.length === 0) return null;

  return (
    <span className={styles.featureBadgeGroup}>
      {sessions.map((session) => (
        <span
          role="button"
          tabIndex={-1}
          key={`troubled-${session.sessionId}`}
          className={`${styles.featureBadge} ${styles.featureBadge_troubled}`}
          data-testid="feature-troubled"
          title={getTroubledBadgeTitle(session)}
          onClick={(event) => handleClearTroubled(event, session.sessionId)}
        >
          <AlertTriangle size={10} aria-hidden />
          {getTroubledBadgeLabel(session)}
        </span>
      ))}
    </span>
  );
}

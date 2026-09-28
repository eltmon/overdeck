/**
 * PAN-4280 (WI-15, D7c) — the Command Deck's empty state when projects are
 * registered but none is selected. Adds "Start without a project" to the
 * existing "Select a project…" copy so the no-project deck stays reachable
 * even when registered projects exist.
 */
import { Compass } from 'lucide-react';

import styles from './styles/command-deck.module.css';

export interface DeckEmptyStateProps {
  onStartWithoutProject: () => void;
}

export function DeckEmptyState({ onStartWithoutProject }: DeckEmptyStateProps) {
  return (
    <div className={styles.contentEmpty}>
      <div style={{ textAlign: 'center' }}>
        <Compass size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
        <p>Select a project to open its deck</p>
        <button type="button" onClick={onStartWithoutProject} className="mt-3 text-sm text-primary underline underline-offset-2">
          Start without a project
        </button>
      </div>
    </div>
  );
}

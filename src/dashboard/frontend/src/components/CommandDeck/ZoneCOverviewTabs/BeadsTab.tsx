/**
 * BeadsTab — wraps the existing BeadsTasksPanel, which already owns its own
 * data fetch, list/graph toggle, and item details. We keep this thin so the
 * Beads UX has a single source of truth (BeadsTasksPanel) shared between the
 * old BeadsDialog and this Command Deck tab.
 */

import { BeadsTasksPanel } from '../../BeadsTasksPanel';

interface BeadsTabProps {
  issueId: string;
}

export function BeadsTab({ issueId }: BeadsTabProps) {
  return (
    <div data-testid="beads-tab" style={{ padding: 16 }}>
      <BeadsTasksPanel issueId={issueId} />
    </div>
  );
}

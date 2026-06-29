import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { UatStackStatus, type getUatStackSummary } from '../UatStackStatus';
import type { WorkspaceData } from '../ZoneCOverviewTabs/queries';
import styles from '../styles/command-deck.module.css';

type UatStackSummary = NonNullable<ReturnType<typeof getUatStackSummary>>;

interface UatStackTreeGroupProps {
  summary: UatStackSummary;
  workspace?: WorkspaceData;
  pending: boolean;
}

export function UatStackTreeGroup({ summary, workspace, pending }: UatStackTreeGroupProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.uatStackTreeGroup}>
      <button
        type="button"
        className={styles.uatStackTreeHeader}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label="Toggle UAT environment details"
        title="Toggle UAT environment details"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>UAT environment</span>
        <span className={styles.uatStackTreeSummary}>{summary.label.replace(/^UAT stack\s*/i, '')}</span>
      </button>
      {expanded && (
        <UatStackStatus
          containers={workspace?.containers}
          stackHealth={workspace?.stackHealth}
          frontendUrl={workspace?.frontendUrl}
          apiUrl={workspace?.apiUrl}
          pending={pending}
          density="tree"
        />
      )}
    </div>
  );
}

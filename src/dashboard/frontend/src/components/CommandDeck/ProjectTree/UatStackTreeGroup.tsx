import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { UatStackStatus, type getUatStackSummary } from '../UatStackStatus';
import type { WorkspaceData } from '../ZoneCOverviewTabs/queries';
import styles from '../styles/command-deck.module.css';

type UatStackSummary = NonNullable<ReturnType<typeof getUatStackSummary>>;

interface UatStackTreeGroupProps {
  summary: UatStackSummary;
  workspace?: WorkspaceData;
  pending: boolean;
  storageKey: string;
}

function readExpanded(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function writeExpanded(storageKey: string, expanded: boolean): void {
  try {
    if (expanded) {
      localStorage.setItem(storageKey, 'true');
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // ignore
  }
}

export function UatStackTreeGroup({ summary, workspace, pending, storageKey }: UatStackTreeGroupProps) {
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const handleToggle = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      writeExpanded(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return (
    <div className={styles.uatStackTreeGroup}>
      <button
        type="button"
        className={styles.uatStackTreeHeader}
        onClick={handleToggle}
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

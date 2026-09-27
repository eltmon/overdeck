import { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ContainerNode, type ContainerNodeProps } from './ContainerNode';
import styles from '../styles/command-deck.module.css';

export interface ResourcesGroupProps {
  issueId: string;
  containers: ContainerNodeProps[];
  defaultExpanded?: boolean;
  onContainerAction?: (action: string, containerName: string) => void;
}

function getStorageKey(issueId: string): string {
  return `pan-tree-resources-${issueId}`;
}

function readExpanded(issueId: string): boolean | null {
  try {
    const raw = localStorage.getItem(getStorageKey(issueId));
    if (raw === null) return null;
    return raw === 'true';
  } catch {
    return null;
  }
}

function writeExpanded(issueId: string, expanded: boolean): void {
  try {
    localStorage.setItem(getStorageKey(issueId), String(expanded));
  } catch {
    // ignore
  }
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ResourcesGroup({
  issueId,
  containers,
  defaultExpanded = false,
  onContainerAction,
}: ResourcesGroupProps) {
  const [expanded, setExpanded] = useState(() => {
    const persisted = readExpanded(issueId);
    return persisted ?? defaultExpanded;
  });

  const handleToggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(issueId, next);
  }, [expanded, issueId]);

  const summary = useMemo(() => countLabel(containers.length, 'container', 'containers'), [containers.length]);

  const sortedContainers = useMemo(
    () => [...containers].sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
    [containers],
  );

  if (containers.length === 0) {
    return null;
  }

  return (
    <div className={styles.resourcesGroup}>
      <button
        className={styles.resourcesGroupHeader}
        onClick={handleToggle}
        aria-label={expanded ? 'Collapse resources' : 'Expand resources'}
        title={expanded ? 'Collapse resources' : 'Expand resources'}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Containers</span>
        <span className={styles.resourcesGroupSummary}>{summary}</span>
      </button>

      {expanded && (
        <div>
          {sortedContainers.map((container) => (
            <ContainerNode
              key={container.name}
              {...container}
              onViewLogs={onContainerAction ? (name) => onContainerAction('viewLogs', name) : undefined}
              onRestart={onContainerAction ? (name) => onContainerAction('restart', name) : undefined}
              onStop={onContainerAction ? (name) => onContainerAction('stop', name) : undefined}
              onStart={onContainerAction ? (name) => onContainerAction('start', name) : undefined}
              onInspect={onContainerAction ? (name) => onContainerAction('inspect', name) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

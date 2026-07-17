import type { TreeSessionFilter } from './ProjectTree/FeatureItem';
import { usePlannedBacklogVisibility } from '../../hooks/usePlannedBacklogVisibility';
import styles from './styles/command-deck.module.css';

interface IssuesPaneFilterRowProps {
  filter: TreeSessionFilter;
  onFilterChange: (filter: TreeSessionFilter) => void;
}

export function IssuesPaneFilterRow({ filter, onFilterChange }: IssuesPaneFilterRowProps) {
  const showPlannedBacklog = usePlannedBacklogVisibility((state) => state.showPlannedBacklog);
  const toggleShowPlannedBacklog = usePlannedBacklogVisibility((state) => state.toggleShowPlannedBacklog);

  return (
    <div className={styles.treeFilterRow}>
      {(['all', 'alive', 'failed'] as TreeSessionFilter[]).map((value) => (
        <button
          key={value}
          onClick={() => onFilterChange(value)}
          className={`${styles.treeFilterButton} ${filter === value ? styles.treeFilterButtonActive : ''}`}
        >
          {value === 'all' ? 'All' : value === 'alive' ? 'Alive' : 'Failed'}
        </button>
      ))}
      <button
        data-testid="planned-backlog-toggle"
        title="Show spec-only planned items (planned_backlog)"
        aria-pressed={showPlannedBacklog}
        onClick={toggleShowPlannedBacklog}
        className={`${styles.treeFilterButton} ${showPlannedBacklog ? styles.treeFilterButtonActive : ''}`}
      >
        Planned
      </button>
    </div>
  );
}

/**
 * IssuesFilterMenu — the Issues section's one filter control (PAN-5293
 * F-D17): All / Alive / Failed sessions, plus a Planned checkbox for
 * spec-only planned issues. Replaces the deck's IssuesPaneFilterRow.
 */

import { useRef, useState } from 'react';
import { Check, ListFilter } from 'lucide-react';
import type { TreeSessionFilter } from '../CommandDeck/ProjectTree/FeatureItem';
import { usePlannedBacklogVisibility } from '../../hooks/usePlannedBacklogVisibility';
import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu';

const FILTER_LABELS: Record<TreeSessionFilter, string> = { all: 'All', alive: 'Alive', failed: 'Failed' };

export interface IssuesFilterMenuProps {
  filter: TreeSessionFilter;
  onFilterChange: (filter: TreeSessionFilter) => void;
}

export function IssuesFilterMenu({ filter, onFilterChange }: IssuesFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showPlannedBacklog = usePlannedBacklogVisibility((state) => state.showPlannedBacklog);
  const toggleShowPlannedBacklog = usePlannedBacklogVisibility((state) => state.toggleShowPlannedBacklog);

  return (
    <span className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="issues-filter"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="list-row flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
      >
        <ListFilter aria-hidden className="h-3 w-3" />
        Filter: {FILTER_LABELS[filter]}
      </button>
      {open && (
        <>
          <MenuOverlay onClick={() => setOpen(false)} />
          <MenuSurface
            aria-label="Filter issues"
            onClose={() => setOpen(false)}
            returnFocusRef={triggerRef}
            className="absolute right-0 top-full z-[1000] mt-1 w-[180px]"
          >
            {(Object.keys(FILTER_LABELS) as TreeSessionFilter[]).map((value) => (
              <MenuItemButton
                key={value}
                role="menuitemradio"
                aria-checked={filter === value}
                onClick={() => { onFilterChange(value); setOpen(false); }}
              >
                {FILTER_LABELS[value]}
                {filter === value && <Check aria-hidden size={14} className="ml-auto" />}
              </MenuItemButton>
            ))}
            <MenuSeparator />
            <MenuItemButton
              role="menuitemcheckbox"
              aria-checked={showPlannedBacklog}
              data-testid="planned-backlog-toggle"
              title="Show spec-only planned items (planned_backlog)"
              onClick={toggleShowPlannedBacklog}
            >
              Planned
              {showPlannedBacklog && <Check aria-hidden size={14} className="ml-auto" />}
            </MenuItemButton>
          </MenuSurface>
        </>
      )}
    </span>
  );
}

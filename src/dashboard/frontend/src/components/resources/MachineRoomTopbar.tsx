import type { Ref } from 'react';

export type MachineRoomGroupBy = 'workspace' | 'kind' | 'flat';

interface MachineRoomTopbarProps {
  filter: string;
  filterRef: Ref<HTMLInputElement>;
  groupBy: MachineRoomGroupBy;
  stale: boolean;
  updatedAt?: string;
  onFilterChange: (value: string) => void;
  onGroupByChange: (value: MachineRoomGroupBy) => void;
}

const GROUP_OPTIONS: Array<{ id: MachineRoomGroupBy; label: string }> = [
  { id: 'workspace', label: 'By workspace' },
  { id: 'kind', label: 'By kind' },
  { id: 'flat', label: 'Flat' },
];

export function MachineRoomTopbar({
  filter,
  filterRef,
  groupBy,
  stale,
  updatedAt,
  onFilterChange,
  onGroupByChange,
}: MachineRoomTopbarProps) {
  return (
    <div className="border-b border-border bg-background px-6 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold text-foreground">Machine Room</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Auto-refresh</span>
          {stale && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600">
              stale
            </span>
          )}
          {updatedAt && <span>{new Date(updatedAt).toLocaleTimeString()}</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={filterRef}
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter resources"
            aria-label="Filter resources"
            className="h-8 w-56 border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <div className="flex border border-border" role="group" aria-label="Group resources">
            {GROUP_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onGroupByChange(option.id)}
                className={`h-8 px-3 text-xs ${
                  groupBy === option.id
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 font-['DM_Mono'] text-[11px] text-muted-foreground">
        / filter · S stop · P pause · L logs
      </div>
    </div>
  );
}

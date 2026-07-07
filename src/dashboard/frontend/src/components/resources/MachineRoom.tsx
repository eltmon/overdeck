import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, ContainerStats, ResourcesSnapshot } from '../../types';
import { MachineRoomTopbar, type MachineRoomGroupBy } from './MachineRoomTopbar';
import { VitalsStrip } from './VitalsStrip';

type MachineRoomRow =
  | { id: string; kind: 'container'; label: string; issue: string; status: string; container: ContainerStats }
  | { id: string; kind: 'agent'; label: string; issue: string; status: string; agent: Agent };

interface MachineRoomProps {
  snapshot: ResourcesSnapshot;
  onNavigateToAgents?: (agentId: string) => void;
  onStop?: (row: MachineRoomRow) => void;
  onPause?: (row: MachineRoomRow) => void;
  onLogs?: (row: MachineRoomRow) => void;
}

export function MachineRoom({ snapshot, onNavigateToAgents, onStop, onPause, onLogs }: MachineRoomProps) {
  const [filter, setFilter] = useState('');
  const [groupBy, setGroupBy] = useState<MachineRoomGroupBy>('workspace');
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const filteredRows = rows.filter((row) => matchesFilter(row, filter));
  const focusedRow = filteredRows.find((row) => row.id === focusedRowId) ?? null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && target?.tagName !== 'INPUT') {
        event.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (!focusedRow) return;
      const key = event.key.toLowerCase();
      if (key === 's') onStop?.(focusedRow);
      if (key === 'p') onPause?.(focusedRow);
      if (key === 'l') onLogs?.(focusedRow);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedRow, onLogs, onPause, onStop]);

  const groups = groupRows(filteredRows, groupBy);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background font-['DM_Sans']">
      <MachineRoomTopbar
        filter={filter}
        filterRef={filterRef}
        groupBy={groupBy}
        stale={snapshot.stale === true || snapshot.hostVitals?.stale === true}
        updatedAt={snapshot.updatedAt}
        onFilterChange={setFilter}
        onGroupByChange={setGroupBy}
      />
      <VitalsStrip hostVitals={snapshot.hostVitals} />
      <div className="flex-1 overflow-auto px-6 py-5">
        {groups.map((group) => (
          <section key={group.key} className="mb-6">
            <h2 className="mb-2 font-['DM_Mono'] text-xs uppercase text-muted-foreground">
              {group.label} · {group.rows.length}
            </h2>
            <div className="divide-y divide-border border border-border">
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="grid w-full grid-cols-[120px_1fr_140px_120px] items-center gap-3 bg-background px-4 py-3 text-left text-sm hover:bg-muted/40 focus:bg-muted focus:outline-none"
                  onFocus={() => setFocusedRowId(row.id)}
                  onDoubleClick={() => row.kind === 'agent' && onNavigateToAgents?.(row.agent.id)}
                >
                  <span className="font-['DM_Mono'] text-xs uppercase text-muted-foreground">{row.kind}</span>
                  <span className="truncate font-medium text-foreground">{row.label}</span>
                  <span className="font-['DM_Mono'] text-xs text-muted-foreground">{row.issue}</span>
                  <span className="text-xs text-muted-foreground">{row.status}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {filteredRows.length === 0 && (
          <div className="border border-border p-8 text-sm text-muted-foreground">No resources match the filter.</div>
        )}
      </div>
    </div>
  );
}

function buildRows(snapshot: ResourcesSnapshot): MachineRoomRow[] {
  return [
    ...snapshot.containers.map((container): MachineRoomRow => ({
      id: `container:${container.id}`,
      kind: 'container',
      label: container.name,
      issue: issueFromContainer(container.name),
      status: container.status,
      container,
    })),
    ...snapshot.agents.map((agent): MachineRoomRow => ({
      id: `agent:${agent.id}`,
      kind: 'agent',
      label: agent.id,
      issue: agent.issueId ?? 'unassigned',
      status: agent.status,
      agent,
    })),
  ];
}

function groupRows(rows: MachineRoomRow[], groupBy: MachineRoomGroupBy) {
  if (groupBy === 'flat') return [{ key: 'flat', label: 'All resources', rows }];
  const groups = new Map<string, MachineRoomRow[]>();
  for (const row of rows) {
    const key = groupBy === 'kind' ? row.kind : row.issue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    label: key,
    rows: groupRows,
  }));
}

function matchesFilter(row: MachineRoomRow, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return [row.label, row.issue, row.status, row.kind, row.id]
    .some((value) => value.toLowerCase().includes(query));
}

function issueFromContainer(name: string) {
  return name.match(/(?:feature[_-])?([a-z]+-\d+)/i)?.[1]?.toUpperCase() ?? 'ungrouped';
}

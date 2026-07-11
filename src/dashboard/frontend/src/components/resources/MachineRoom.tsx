import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, ContainerStats, ResourceStack, ResourcesSnapshot } from '../../types';
import { AgentsSection } from './AgentsSection';
import { CoreServicesSection } from './CoreServicesSection';
import { HistorySection } from './HistorySection';
import { HostProcessesSection } from './HostProcessesSection';
import { MachineRoomTopbar, type MachineRoomGroupBy } from './MachineRoomTopbar';
import { ReclaimAdvisor } from './ReclaimAdvisor';
import { StacksSection } from './StacksSection';
import { serviceBusyKey, stackBusyKey } from './StackCard';
import type { ServiceAction, StackAction } from './StackActions';
import { TeardownModal } from './TeardownModal';
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
  onRefresh?: () => void | Promise<void>;
  onContainerTerminal?: (container: ContainerStats) => void;
}

export function MachineRoom({
  snapshot,
  onNavigateToAgents,
  onStop,
  onPause,
  onLogs,
  onRefresh,
  onContainerTerminal,
}: MachineRoomProps) {
  const [filter, setFilter] = useState('');
  const [groupBy, setGroupBy] = useState<MachineRoomGroupBy>('workspace');
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [highlightedTarget, setHighlightedTarget] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [logsPanel, setLogsPanel] = useState<{ title: string; logs: string } | null>(null);
  const [teardownStack, setTeardownStack] = useState<ResourceStack | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const filteredRows = rows.filter((row) => matchesFilter(row, filter));
  const focusedRow = filteredRows.find((row) => row.id === focusedRowId) ?? null;
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

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
      if (key === 's') handleRowStop(focusedRow);
      if (key === 'p') handleRowPause(focusedRow);
      if (key === 'l') handleRowLogs(focusedRow);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedRow, onLogs, onPause, onStop]);

  async function runMutation(key: string, url: string) {
    setBusyKeys((current) => new Set(current).add(key));
    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
      await onRefresh?.();
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function runStackAction(stack: ResourceStack, action: StackAction) {
    const issueId = stack.issueId ?? stack.id;
    void runMutation(stackBusyKey(stack, action), `/api/resources/stacks/${encodeURIComponent(issueId)}/${action}`);
  }

  function runServiceAction(service: ContainerStats, action: ServiceAction) {
    void runMutation(serviceBusyKey(service, action), `/api/resources/docker/container/${encodeURIComponent(service.id)}/${action}`);
  }

  async function openServiceLogs(service: ContainerStats) {
    const key = serviceBusyKey(service, 'logs');
    setBusyKeys((current) => new Set(current).add(key));
    try {
      const response = await fetch(`/api/resources/docker/container/${encodeURIComponent(service.id)}/logs`);
      if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
      const body = await response.json() as { logs?: string };
      setLogsPanel({ title: service.name, logs: body.logs ?? '' });
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function handleRowStop(row: MachineRoomRow) {
    if (onStop) return onStop(row);
    if (row.kind === 'container') runServiceAction(row.container, 'stop');
  }

  function handleRowPause(row: MachineRoomRow) {
    if (onPause) return onPause(row);
    if (row.kind === 'container') runServiceAction(row.container, row.container.status === 'paused' ? 'unpause' : 'pause');
  }

  function handleRowLogs(row: MachineRoomRow) {
    if (onLogs) return onLogs(row);
    if (row.kind === 'container') void openServiceLogs(row.container);
  }

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
      <VitalsStrip hostVitals={snapshot.hostVitals} spawnGate={snapshot.spawnGate} />
      <div className="flex-1 overflow-auto px-6 py-5">
        <AgentsSection
          agents={snapshot.agents}
          filter={filter}
          highlightedTarget={highlightedTarget}
          onFocusRow={setFocusedRowId}
          onOpenTerminal={(agent) => onNavigateToAgents?.(agent.id)}
          onPause={(agent) => {
            const row = rowById.get(`agent:${agent.id}`);
            if (row) onPause?.(row);
          }}
        />
        <ReclaimAdvisor
          candidates={snapshot.reclaimCandidates}
          totals={snapshot.reclaimTotals}
          thresholdBytes={snapshot.reclaimThresholdBytes}
        />
        <StacksSection
          stacks={snapshot.stacks ?? []}
          filter={filter}
          groupBy={groupBy}
          busyKeys={busyKeys}
          onStackAction={runStackAction}
          onServiceAction={runServiceAction}
          onServiceLogs={(service) => { void openServiceLogs(service); }}
          onServiceTerminal={onContainerTerminal}
          onTeardown={setTeardownStack}
        />
        {logsPanel && (
          <section className="mb-6 border border-border bg-background" aria-label="Container logs">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-foreground">Logs · {logsPanel.title}</h2>
              <button type="button" className="border border-border px-2 py-1 text-xs uppercase" onClick={() => setLogsPanel(null)}>Close</button>
            </div>
            <pre className="max-h-64 overflow-auto p-4 font-['DM_Mono'] text-xs text-foreground">{logsPanel.logs}</pre>
          </section>
        )}
        <HistorySection forecast={snapshot.forecast} onHighlightTarget={setHighlightedTarget} />
        <CoreServicesSection services={snapshot.coreServices ?? []} filter={filter} onFocusRow={setFocusedRowId} />
        <HostProcessesSection processes={snapshot.hostProcesses ?? []} filter={filter} onFocusRow={setFocusedRowId} />
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
      {teardownStack && (
        <TeardownModal
          stack={teardownStack}
          onClose={() => setTeardownStack(null)}
          onComplete={onRefresh}
        />
      )}
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

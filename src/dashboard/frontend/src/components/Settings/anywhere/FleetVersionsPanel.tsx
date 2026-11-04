/**
 * Settings → Anywhere → Fleet versions (PAN-4654 WI-9, FR-12): one row per
 * machine (this machine first, then each linked machine), one column per
 * harness CLI found anywhere in the fleet, and Update all. A waiting row has
 * Update now and Cancel. Polls `GET /api/machines/versions` every 5 s while
 * any machine has an active update job, else every 30 s.
 *
 * Style guide: no pills and no green. Link states reuse `LinkStateBadge`
 * (`unsupported` amber); job status text stays muted.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { compareFleetBinaries, FLEET_UPDATE_STILL_WAITING_MS } from '@overdeck/contracts';

import { useConfirm } from '../../DialogProvider';
import { apiError, isOk } from './anywhereApi';
import { LinkStateBadge } from './MachinesPanel';
import {
  FLEET_VERSIONS_QUERY_KEY,
  type FleetUpdateInput,
  type FleetUpdateJob,
  type FleetVersionRow,
  loadFleetVersions,
  updateFleet,
} from './machinesApi';

const ACTIVE_PHASES: ReadonlySet<FleetUpdateJob['phase']> = new Set(['waiting', 'updating', 'restarting']);
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

const buttonClass = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A version cell: the version, or `before → after` once a finished component changed it; a skipped CLI is muted with its reason. */
function VersionCell({ job, name, version }: { job: FleetUpdateJob | null; name: string; version: string | null | undefined }) {
  const component = job?.components.find((entry) => entry.name === name);
  if (component && component.status !== 'pending' && component.status !== 'running' && component.after !== null && component.after !== component.before) {
    return <span className="font-mono">{component.before ?? '—'} → {component.after}</span>;
  }
  if (component?.status === 'skipped') {
    return <span className="font-mono text-muted-foreground" title={`not updated: ${component.detail ?? ''}`}>{version ?? '—'}</span>;
  }
  return <span className="font-mono">{version ?? '—'}</span>;
}

function jobText(job: FleetUpdateJob | null, now: number): string {
  if (!job) return '—';
  switch (job.phase) {
    case 'waiting': {
      const waited = job.waitingSince ? now - new Date(job.waitingSince).getTime() : 0;
      const base = `Waiting for ${plural(job.waitingTurns, 'turn')}`;
      return waited >= FLEET_UPDATE_STILL_WAITING_MS ? `${base}, still waiting after ${Math.floor(waited / 60_000)} min` : base;
    }
    case 'updating': return 'Updating';
    case 'restarting': return 'Restarting the dashboard';
    case 'done': return 'Done';
    case 'cancelled': return 'Cancelled';
    case 'failed': {
      const failed = job.components.find((component) => component.status === 'failed');
      return failed ? `Failed: ${failed.label}` : 'Failed';
    }
  }
}

function CopyCommand({ command }: { command: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-foreground">{command}</span>
      <button type="button" className={buttonClass} onClick={() => void navigator.clipboard?.writeText(command)}>Copy</button>
    </span>
  );
}

function FleetRow({ row, binaries, onUpdate, busy }: {
  row: FleetVersionRow;
  binaries: string[];
  onUpdate: (input: FleetUpdateInput, label: string) => Promise<void>;
  busy: boolean;
}) {
  const job = row.report?.job ?? null;
  const failed = job?.components.find((component) => component.status === 'failed');
  const note = row.install
    ? (
      <>
        Install Overdeck {row.install.version} on {row.install.on === 'this-machine' ? 'this machine' : row.label}:{' '}
        <CopyCommand command={row.install.command} />
      </>
    )
    : row.error;
  return (
    <>
      <tr data-testid={`fleet-row-${row.environmentId}`} className="border-t border-border align-top">
        <td className="px-3 py-2 text-foreground whitespace-nowrap">
          {row.label}
          {row.self && <span className="text-muted-foreground"> · this machine</span>}
        </td>
        <td className="px-3 py-2">{row.state === 'self' ? null : <LinkStateBadge state={row.state} />}</td>
        <td className="px-3 py-2 whitespace-nowrap"><VersionCell job={job} name="overdeck" version={row.report?.overdeck.version ?? row.peerVersion} /></td>
        {binaries.map((binary) => (
          <td key={binary} className="px-3 py-2 whitespace-nowrap">
            <VersionCell job={job} name={binary} version={row.report?.harnesses.find((cli) => cli.binary === binary)?.version} />
          </td>
        ))}
        <td className="px-3 py-2 text-muted-foreground">
          <span data-testid="fleet-job" title={failed?.detail ?? undefined}>{jobText(job, Date.now())}</span>
          {job?.phase === 'waiting' && (
            <span className="mt-1 flex flex-wrap gap-2">
              <button type="button" data-testid="fleet-update-now" disabled={busy} className={buttonClass} onClick={() => void onUpdate({ mode: 'now', environmentIds: [row.environmentId] }, row.label)}>
                Update now
              </button>
              <button type="button" data-testid="fleet-cancel" disabled={busy} className={buttonClass} onClick={() => void onUpdate({ cancel: true, environmentIds: [row.environmentId] }, row.label)}>
                Cancel
              </button>
            </span>
          )}
        </td>
      </tr>
      {note && (
        <tr>
          <td colSpan={binaries.length + 4} className="px-3 pb-2 text-xs text-muted-foreground">{note}</td>
        </tr>
      )}
    </>
  );
}

export function FleetVersionsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: FLEET_VERSIONS_QUERY_KEY,
    queryFn: loadFleetVersions,
    refetchInterval: (query) => (query.state.data?.rows.some((row) => row.report?.job && ACTIVE_PHASES.has(row.report.job.phase)) ? ACTIVE_POLL_MS : IDLE_POLL_MS),
  });

  const rows = data?.rows ?? [];
  const binaries = [...new Set(rows.flatMap((row) => row.report?.harnesses.map((cli) => cli.binary) ?? []))].sort(compareFleetBinaries);
  const labels = new Map(rows.flatMap((row) => row.report?.harnesses.map((cli) => [cli.binary, cli.label] as const) ?? []));
  const updatable = rows.filter((row) => row.updateSupported).length;

  const runUpdate = async (input: FleetUpdateInput, what: string) => {
    setBusy(true);
    try {
      const result = await updateFleet(input);
      if (!isOk(result)) {
        toast.error(`Could not update ${what}: ${apiError(result)}`);
        return;
      }
      const { started, skipped } = result.body;
      if (started.length > 0) toast.success(`${input.cancel ? 'Cancelled' : 'Update started'} on ${started.map((entry) => entry.label).join(', ')}`);
      if (skipped.length > 0) toast.warning(`Skipped ${skipped.map((entry) => `${entry.label} (${entry.reason})`).join('; ')}`);
    } catch (err) {
      toast.error(`Could not update ${what}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: FLEET_VERSIONS_QUERY_KEY });
    }
  };

  const handleUpdateAll = async () => {
    const confirmed = await confirm({
      title: 'Update all machines?',
      message: `Update Overdeck and the harness CLIs on ${plural(updatable, 'online machine')}? Each machine waits for its running turns to end.`,
      confirmLabel: 'Update all',
    });
    if (!confirmed) return;
    await runUpdate({ mode: 'when-idle' }, 'the fleet');
  };

  return (
    <div data-component="anywhere-fleet-versions-panel" data-testid="fleet-versions-panel">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h3 className="text-sm font-medium text-foreground">Fleet versions</h3>
        <button type="button" data-testid="fleet-update-all" disabled={busy || updatable === 0} onClick={() => void handleUpdateAll()} className={buttonClass}>
          Update all
        </button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading versions…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load versions: {(error as Error).message}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-1.5 font-normal">Machine</th>
                <th className="px-3 py-1.5 font-normal">State</th>
                <th className="px-3 py-1.5 font-normal">Overdeck</th>
                {binaries.map((binary) => <th key={binary} className="px-3 py-1.5 font-normal whitespace-nowrap">{labels.get(binary) ?? binary}</th>)}
                <th className="px-3 py-1.5 font-normal">Update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FleetRow key={row.environmentId} row={row} binaries={binaries} busy={busy} onUpdate={runUpdate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

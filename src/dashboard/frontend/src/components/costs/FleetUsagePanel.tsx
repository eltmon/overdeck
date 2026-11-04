/**
 * Costs → Machines (PAN-4651 FR-8, D-4651-19): one row per machine with
 * today / week / month spend, an offline machine's cached numbers with their
 * age, and an All machines footer that counts a provider request recorded on
 * two machines once. Machine labels are plain text; no colour encodes state.
 */
import { useQuery } from '@tanstack/react-query';

import { formatRelativeTime } from '../../lib/dashboard-utils';

interface UsageWindow { totalCost: number; totalTokens: number; entryCount: number }

export interface FleetUsageRow {
  environmentId: string;
  label: string;
  self: boolean;
  state: string;
  cached: boolean;
  fetchedAt: string | null;
  today: UsageWindow | null;
  week: UsageWindow | null;
  month: UsageWindow | null;
}

export interface FleetUsageResponse {
  machines: FleetUsageRow[];
  allMachines: { today: UsageWindow; week: UsageWindow; month: UsageWindow };
  duplicates: { today: UsageWindow; week: UsageWindow; month: UsageWindow };
}

export async function fetchFleetUsage(): Promise<FleetUsageResponse> {
  const res = await fetch('/api/fleet/usage');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<FleetUsageResponse>;
}

const money = (window: UsageWindow | null): string => (window ? `$${window.totalCost.toFixed(2)}` : '—');

export function FleetUsagePanel() {
  const { data, error, isLoading } = useQuery({ queryKey: ['fleet-usage'], queryFn: fetchFleetUsage, refetchInterval: 60_000 });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading machines…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Could not load fleet usage: {(error as Error | null)?.message ?? 'no answer'}</p>;
  const duplicateCost = data.duplicates.month.totalCost;
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden" data-testid="fleet-usage-panel">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left font-normal px-4 py-2">Machine</th>
            <th className="text-right font-normal px-4 py-2">Today</th>
            <th className="text-right font-normal px-4 py-2">Week</th>
            <th className="text-right font-normal px-4 py-2">Month</th>
          </tr>
        </thead>
        <tbody>
          {data.machines.map((row) => (
            <tr key={row.environmentId} className="border-b border-border/50" data-testid={`fleet-usage-row-${row.label}`}>
              <td className="px-4 py-2">
                <span className="text-foreground">{row.label}{row.self ? ' (this machine)' : ''}</span>
                {row.cached && row.fetchedAt && <span className="block text-xs text-muted-foreground">cached {formatRelativeTime(row.fetchedAt)}</span>}
                {!row.self && !row.cached && !row.month && <span className="block text-xs text-muted-foreground">{row.state}, no numbers yet</span>}
              </td>
              <td className="px-4 py-2 text-right font-mono">{money(row.today)}</td>
              <td className="px-4 py-2 text-right font-mono">{money(row.week)}</td>
              <td className="px-4 py-2 text-right font-mono">{money(row.month)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="px-4 py-2 text-foreground">All machines</td>
            <td className="px-4 py-2 text-right font-mono">{money(data.allMachines.today)}</td>
            <td className="px-4 py-2 text-right font-mono">{money(data.allMachines.week)}</td>
            <td className="px-4 py-2 text-right font-mono">{money(data.allMachines.month)}</td>
          </tr>
        </tfoot>
      </table>
      {duplicateCost > 0 && (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          All machines counts {data.duplicates.month.entryCount} request{data.duplicates.month.entryCount === 1 ? '' : 's'} recorded on two machines once (${duplicateCost.toFixed(2)} this month).
        </p>
      )}
    </div>
  );
}

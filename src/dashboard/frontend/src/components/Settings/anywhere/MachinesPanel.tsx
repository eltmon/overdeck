/**
 * Settings → Anywhere → Machines (PAN-4645 WI-20, FR-1/FR-2/FR-4): this
 * machine's identity, every outbound link with its live state and routes,
 * and the machines that hold inbound access here. Polls `GET /api/machines`
 * every 5 s while mounted (D-4645-20).
 *
 * Badge tones follow the style guide: `online` is the machine-working blue
 * (`--info`), never green; `connecting` and `offline` stay neutral;
 * `revoked` and `unsupported` are amber because a person must act.
 *
 * SSH machines (PAN-4404): an **Add an SSH machine** button opens
 * `AddSshMachineDialog`; an SSH-backed row shows its destination, forward
 * state and launch kind in muted text, and its Remove confirmation offers to
 * leave a server this dashboard started running (`RemoveSshMachineDialog`).
 *
 * Fly machines (PAN-4743): an **Add a Fly machine** button opens
 * `AddFlyMachineDialog`, which posts `POST /api/machines/fly`.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMachineLoad, formatMachineProfile } from '@overdeck/contracts';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { AddFlyMachineDialog } from './AddFlyMachineDialog';
import { AddSshMachineDialog } from './AddSshMachineDialog';
import { ANYWHERE_STATUS_QUERY_KEY, apiError, isOk } from './anywhereApi';
import { LinkMachineDialog } from './LinkMachineDialog';
import {
  addMachineRoute,
  type InboundMachineView,
  type LinkAccess,
  type LinkState,
  loadMachines,
  MACHINES_QUERY_KEY,
  type MachineLinkView,
  reconnectMachine,
  removeInboundMachine,
  type SshLinkInfo,
  unlinkMachine,
} from './machinesApi';
import { RemoveSshMachineDialog } from './RemoveSshMachineDialog';
import { SharingSwitches } from './SharingSwitches';
import { CompareSettingsDialog } from './CompareSettingsDialog';
import { AddProjectToMachineDialog } from '../../sidebar/AddProjectToMachineDialog';
import { unlinkMachineKeepingServer } from './sshMachinesApi';

const STATE_LABEL: Record<LinkState, string> = {
  online: 'Online',
  connecting: 'Connecting',
  offline: 'Offline',
  unsupported: 'Unsupported',
  revoked: 'Revoked',
};

/** 8 % background / 32 % border badge formula; one tone per state, never green. */
const STATE_TONE: Record<LinkState, string> = {
  online: 'bg-info/8 border-info/32 text-info-foreground',
  connecting: 'bg-muted border-border text-muted-foreground',
  offline: 'bg-muted border-border text-muted-foreground',
  unsupported: 'bg-warning/8 border-warning/32 text-warning-foreground',
  revoked: 'bg-warning/8 border-warning/32 text-warning-foreground',
};

const ACCESS_LABEL: Record<LinkAccess, string> = {
  operator: 'Operator-level',
  'agent-fenced': 'Agent-fenced',
};

const ROUTE_STATUS_LABEL = {
  untried: 'not tried',
  current: 'in use',
  reachable: 'reachable',
  unreachable: 'unreachable',
} as const;

const buttonClass = 'shrink-0 h-8 rounded-md border border-border px-3 text-[13px] text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';
const destructiveButtonClass = 'shrink-0 h-8 rounded-md border border-border px-3 text-[13px] text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50';

export function LinkStateBadge({ state }: { state: LinkState }) {
  return (
    <span
      data-testid="machine-link-state"
      data-state={state}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${STATE_TONE[state]}`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

function incidentText(link: MachineLinkView): string | null {
  const incident = link.incident;
  if (!incident) return null;
  const seconds = Math.max(1, Math.round(incident.durationMs / 1000));
  const what = incident.kind === 'froze' ? `${link.label} froze for ${seconds} s` : `${seconds} s network gap`;
  return `${what} ${formatRelativeTime(incident.at)}`;
}

/** `SSH me@desk · forward up · Started by Overdeck` (plus the detail when the forward needs attention). */
export function sshLine(ssh: SshLinkInfo): string {
  const launch = ssh.launch === 'managed' ? 'Started by Overdeck' : 'Already running';
  const detail = ssh.forward === 'attention' && ssh.forwardDetail ? ` (${ssh.forwardDetail})` : '';
  return `SSH ${ssh.destination} · forward ${ssh.forward}${detail} · ${launch}`;
}

/** PAN-4651 FR-6/FR-7: ` · CPU 3% · 41 GB · 2 agents · tags: docker, linux · reserved` (muted, part of the meta line). */
function machineLoadText(view: Pick<MachineLinkView, 'load' | 'tags' | 'placement'>): string {
  return [formatMachineLoad(view.load), formatMachineProfile(view.tags, view.placement)].filter(Boolean).join(' · ');
}

function MachineLoadText({ view, lead = true }: { view: Pick<MachineLinkView, 'load' | 'tags' | 'placement'>; lead?: boolean }) {
  const text = machineLoadText(view);
  return text ? <span data-testid="machine-load">{lead ? ' · ' : ''}{text}</span> : null;
}

function MachineLinkRow({ link, onChanged, thisLabel }: { link: MachineLinkView; onChanged: () => Promise<void>; thisLabel: string }) {
  const confirm = useConfirm();
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [routeUrl, setRouteUrl] = useState('');
  const [routeError, setRouteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ status: number; body: unknown }>, failurePrefix: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (!isOk(result)) toast.error(`${failurePrefix}: ${apiError(result)}`);
    } catch (err) {
      toast.error(`${failurePrefix}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
    await onChanged();
  };

  const ssh = link.ssh;

  const handleUnlink = async () => {
    if (ssh) {
      setRemoveOpen(true);
      return;
    }
    const confirmed = await confirm({
      title: `Unlink ${link.label}?`,
      message: `This machine loses access to ${link.label}, and ${link.label} is told to drop its access here. Link again with a new pairing link.`,
      confirmLabel: 'Unlink',
      variant: 'destructive',
    });
    if (!confirmed) return;
    await run(() => unlinkMachine(link.id), `Could not unlink ${link.label}`);
  };

  const handleAddRoute = async () => {
    const url = routeUrl.trim();
    if (url === '') return;
    setRouteError(null);
    setBusy(true);
    try {
      const result = await addMachineRoute(link.id, url);
      if (!isOk(result)) {
        setRouteError(apiError(result));
        return;
      }
      setRouteUrl('');
    } catch (err) {
      setRouteError((err as Error).message);
    } finally {
      setBusy(false);
    }
    await onChanged();
  };

  const handleRemoveSsh = async (keepServer: boolean) => {
    setRemoveOpen(false);
    await run(() => (keepServer ? unlinkMachineKeepingServer(link.id) : unlinkMachine(link.id)), `Could not remove ${link.label}`);
  };

  const showReconnect = link.state === 'offline' || link.state === 'unsupported' || ssh?.forward === 'down' || ssh?.forward === 'attention';
  const incident = incidentText(link);
  const health = [
    link.peerVersion ? `Overdeck ${link.peerVersion}` : null,
    link.lastHeartbeatAt ? `heartbeat ${formatRelativeTime(link.lastHeartbeatAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <li data-testid={`machine-link-${link.id}`} data-link-id={link.id} className="px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate" title={link.label}>{link.label}</span>
          <LinkStateBadge state={link.state} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => setRoutesOpen((open) => !open)} aria-expanded={routesOpen} className={buttonClass}>
            {routesOpen ? 'Hide routes' : `Routes (${link.routes.length})`}
          </button>
          {showReconnect && (
            <button type="button" disabled={busy} onClick={() => void run(() => reconnectMachine(link.id), `Could not reconnect ${link.label}`)} className={buttonClass}>
              Reconnect
            </button>
          )}
          {link.state === 'online' && (
            <button type="button" onClick={() => setCompareOpen(true)} className={buttonClass}>
              Compare settings
            </button>
          )}
          {link.state === 'online' && link.access === 'operator' && (
            <button type="button" onClick={() => setAddProjectOpen(true)} className={buttonClass}>
              Add a project
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void handleUnlink()} className={destructiveButtonClass}>
            {ssh ? 'Remove' : 'Unlink'}
          </button>
        </div>
      </div>
      <div className="mt-1.5 space-y-0.5 text-[13px] leading-relaxed text-muted-foreground min-w-0">
        <p className="truncate">
          {link.currentRoute ? (
            <>via {link.routes.find((route) => route.url === link.currentRoute)?.kind ?? 'route'} · <span className="font-mono text-xs text-body-foreground" title={link.currentRoute}>{link.currentRoute}</span></>
          ) : 'no route in use'}
          {' · '}{ACCESS_LABEL[link.access]}
        </p>
        {(health || machineLoadText(link)) && (
          <p>
            {health}
            <MachineLoadText view={link} lead={health !== ''} />
          </p>
        )}
        {ssh && <p className="truncate" data-testid={`machine-ssh-${link.id}`}>{sshLine(ssh)}</p>}
        {link.stateDetail && <p>{link.stateDetail}</p>}
        {incident && <p>{incident}</p>}
      </div>

      {routesOpen && (
        <div className="mt-3 space-y-2" data-testid={`machine-routes-${link.id}`}>
          {link.routes.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No routes yet.</p>
          ) : (
            <ul className="space-y-1">
              {link.routes.map((route) => (
                <li key={route.url} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-mono text-xs text-foreground truncate">{route.url}</span>
                  <span className="text-muted-foreground shrink-0">{route.kind} · {route.source} · {ROUTE_STATUS_LABEL[route.status]}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label={`Route URL for ${link.label}`}
              placeholder="tcp://192.168.1.5:3011"
              value={routeUrl}
              onChange={(e) => {
                setRouteUrl(e.target.value);
                setRouteError(null);
              }}
              className="flex-1 min-w-0 h-8 bg-background border border-border rounded-md px-2.5 text-[13px] text-foreground font-mono focus:ring-1 focus:ring-primary"
            />
            <button type="button" disabled={busy || routeUrl.trim() === ''} onClick={() => void handleAddRoute()} className={buttonClass}>
              Add route
            </button>
          </div>
          {routeError && <p className="text-[13px] text-destructive">{routeError}</p>}
        </div>
      )}
      {removeOpen && ssh && (
        <RemoveSshMachineDialog link={{ ...link, ssh }} onCancel={() => setRemoveOpen(false)} onConfirm={(keepServer) => void handleRemoveSsh(keepServer)} />
      )}
      {compareOpen && <CompareSettingsDialog machine={link.environmentId} label={link.label} onClose={() => setCompareOpen(false)} />}
      {addProjectOpen && (
        <AddProjectToMachineDialog target={{ direction: 'there', machine: link.environmentId, machineLabel: link.label, thisLabel }} onClose={() => setAddProjectOpen(false)} />
      )}
    </li>
  );
}

function InboundRow({ inbound, onChanged }: { inbound: InboundMachineView; onChanged: () => Promise<void> }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    const confirmed = await confirm({
      title: `Remove ${inbound.label}'s access?`,
      message: `${inbound.label} can no longer reach this machine; its open connections close now.`,
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await removeInboundMachine(inbound.tokenId);
      if (!isOk(result)) toast.error(`Could not remove ${inbound.label}: ${apiError(result)}`);
    } catch (err) {
      toast.error(`Could not remove ${inbound.label}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
    await onChanged();
  };

  return (
    <li data-testid={`machine-inbound-${inbound.tokenId}`} className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground">{inbound.label}</span>
        <p className="text-[13px] text-muted-foreground mt-0.5 truncate">
          <span className="font-mono text-xs">{inbound.fingerprint}</span>
          {' · '}{ACCESS_LABEL[inbound.access]}
          {' · '}last used {inbound.lastUsedAt ? formatRelativeTime(inbound.lastUsedAt) : '—'}
        </p>
      </div>
      <button type="button" disabled={busy} onClick={() => void handleRemove()} className={destructiveButtonClass}>
        Remove
      </button>
    </li>
  );
}

/** PAN-4650 D-4: Share my conversations, under this machine's label. */
export function MachinesPanel() {
  const queryClient = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [flyOpen, setFlyOpen] = useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: MACHINES_QUERY_KEY,
    queryFn: loadMachines,
    refetchInterval: 5000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY }),
    ]);
  };

  return (
    <div data-component="anywhere-machines-panel" data-testid="machines-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        <h3 className="text-sm font-medium text-foreground">Machines</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setFlyOpen(true)} className={buttonClass}>
            {data?.self.remoteEnabled === false ? 'Add a Fly machine (remote off)' : 'Add a Fly machine'}
          </button>
          <button type="button" onClick={() => setSshOpen(true)} className={buttonClass}>
            Add an SSH machine
          </button>
          <button type="button" onClick={() => setLinkOpen(true)} className={buttonClass}>
            Link a machine
          </button>
        </div>
      </div>
      {data && (
        <p className="text-[13px] leading-relaxed text-muted-foreground px-4 mb-3">
          This machine: {data.self.label}
          <span className="block">
            fingerprint <span className="font-mono text-xs">{data.self.fingerprint}</span>
            <MachineLoadText view={data.self} />
          </span>
        </p>
      )}
      {data && <SharingSwitches self={data.self} onChanged={refresh} />}
      {isLoading ? (
        <p className="text-[13px] text-muted-foreground px-4 py-3">Loading machines…</p>
      ) : error ? (
        <p className="text-[13px] text-destructive px-4 py-3">Could not load machines: {(error as Error).message}</p>
      ) : !data || data.links.length === 0 ? (
        <p className="text-[13px] text-muted-foreground px-4 py-3">No machines are linked yet. Pair another Overdeck machine and paste its pairing link here.</p>
      ) : (
        <ul className="space-y-1">
          {data.links.map((link) => <MachineLinkRow key={link.id} link={link} onChanged={refresh} thisLabel={data.self.label} />)}
        </ul>
      )}

      {data && (
        <div className="mt-4">
          <h4 className="text-[13px] font-medium text-muted-foreground px-4 mb-1">Inbound</h4>
          {data.inbound.length === 0 ? (
            <p className="text-[13px] text-muted-foreground px-4 py-2">No other machine has access to this one.</p>
          ) : (
            <ul className="space-y-1">
              {data.inbound.map((inbound) => <InboundRow key={inbound.tokenId} inbound={inbound} onChanged={refresh} />)}
            </ul>
          )}
        </div>
      )}

      <LinkMachineDialog open={linkOpen} onClose={() => setLinkOpen(false)} />
      <AddSshMachineDialog open={sshOpen} onClose={() => setSshOpen(false)} />
      <AddFlyMachineDialog open={flyOpen} onClose={() => setFlyOpen(false)} />
    </div>
  );
}

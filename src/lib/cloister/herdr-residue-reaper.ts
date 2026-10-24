/**
 * Reap idle restored shell panes in Overdeck-owned Herdr workspaces (PAN-4582 W6).
 *
 * After a Herdr session restore, agent panes come back as plain shells: no
 * `agentId` token (a restore drops pane tokens, #4096), never detected, and
 * their foreground process is back at its prompt. Nothing else closes them,
 * so they accumulate across restores.
 *
 * A candidate is closed only once it has been SEEN TWICE across sweeps — a
 * pane mid-launch looks identical to a residue shell for the few seconds
 * before Overdeck stamps its tokens, and a single sweep cannot tell the
 * difference. The workspace's last pane is never closed even if it is
 * residue: it is the workspace's root shell, and closing it would close the
 * workspace.
 */
import { emitActivityEntry } from '../activity-logger.js';
import { logDeaconEvent } from '../persistent-logger.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';
import { getHerdrApiClient, type HerdrApiClient } from '../terminal-backends/herdr-api.js';
import { AGENT_ID_TOKEN, paneProcessLiveness } from '../terminal-backends/herdr.js';
import { hostTerminalBackendName, probeHerdrAvailability } from '../terminal-backends/select.js';
import type { HerdrWorkspaceInfo } from '../terminal-backends/herdr-workspaces.js';

/** One pane as the reaper sees it. */
export interface ResiduePaneView {
  readonly paneId: string;
  readonly terminalId: string;
  readonly workspaceId: string;
  readonly hasAgentId: boolean;
  readonly detected: boolean;
  readonly process: 'running' | 'exited' | 'indeterminate';
}

export interface ResidueSelection {
  /** Panes to close now. */
  readonly close: readonly ResiduePaneView[];
  /** Candidate keys (`paneId|terminalId`) to remember for the next sweep. */
  readonly sighted: ReadonlySet<string>;
}

function residueKey(pane: Pick<ResiduePaneView, 'paneId' | 'terminalId'>): string {
  return `${pane.paneId}|${pane.terminalId}`;
}

/**
 * Pure selection: deterministic and side-effect-free so the close set can be
 * unit-tested. Only panes in an owned workspace are ever considered.
 */
export function selectHerdrResiduePanes(input: {
  readonly ownedWorkspaceIds: ReadonlySet<string>;
  readonly panes: readonly ResiduePaneView[];
  readonly previous: ReadonlySet<string>;
}): ResidueSelection {
  const byWorkspace = new Map<string, ResiduePaneView[]>();
  for (const pane of input.panes) {
    if (!input.ownedWorkspaceIds.has(pane.workspaceId)) continue;
    const list = byWorkspace.get(pane.workspaceId);
    if (list) list.push(pane);
    else byWorkspace.set(pane.workspaceId, [pane]);
  }

  const candidates: ResiduePaneView[] = [];
  for (const panes of byWorkspace.values()) {
    const residue = panes.filter((pane) => !pane.hasAgentId && !pane.detected && pane.process === 'exited');
    // Every pane in the workspace is residue: keep the first (snapshot order)
    // as the workspace's root shell so the workspace itself is never closed.
    candidates.push(...(residue.length === panes.length ? residue.slice(1) : residue));
  }

  const sighted = new Set(candidates.map(residueKey));
  const close = candidates.filter((pane) => input.previous.has(residueKey(pane)));
  return { close, sighted };
}

export interface HerdrResidueReapDeps {
  readonly isPaused?: () => boolean;
  /** Null on a tmux host or when Herdr is unavailable. */
  readonly herdrApi?: () => Promise<HerdrApiClient | null>;
  readonly processLiveness?: (paneId: string, api: HerdrApiClient) => Promise<'running' | 'exited' | 'indeterminate'>;
}

async function defaultHerdrApi(): Promise<HerdrApiClient | null> {
  if ((await hostTerminalBackendName()) !== 'herdr') return null;
  if (!(await probeHerdrAvailability()).available) return null;
  return getHerdrApiClient();
}

let previousSightings = new Set<string>();

/**
 * Sweep Overdeck-owned Herdr workspaces for residue panes and close the ones
 * sighted on a prior sweep too. Returns a human-readable action string per
 * closed pane, for the patrol log. Honors the global deacon pause. Any
 * thrown Herdr error returns `[]` and leaves the previous sighting set
 * unchanged, so a transient outage never skips a pane's second sighting.
 */
export async function reapHerdrResiduePanes(deps: HerdrResidueReapDeps = {}): Promise<string[]> {
  const isPaused = deps.isPaused ?? isDeaconGloballyPaused;
  if (isPaused()) return [];

  const api = await (deps.herdrApi ?? defaultHerdrApi)();
  if (!api) return [];

  const processLiveness = deps.processLiveness ?? paneProcessLiveness;

  try {
    const [workspaceList, snapshot] = await Promise.all([
      api.call<{ workspaces?: HerdrWorkspaceInfo[] }>('workspace.list', {}),
      api.call<{ snapshot?: { panes?: ResidueRawPane[] } }>('session.snapshot', {}),
    ]);

    const ownedWorkspaceIds = new Set(
      (workspaceList.workspaces ?? [])
        .filter((workspace) => Boolean(workspace.tokens?.issue))
        .map((workspace) => workspace.workspace_id),
    );

    const views: ResiduePaneView[] = [];
    for (const pane of snapshot.snapshot?.panes ?? []) {
      if (!ownedWorkspaceIds.has(pane.workspace_id)) continue;
      const hasAgentId = Boolean(pane.tokens?.[AGENT_ID_TOKEN]);
      const detected = Boolean(pane.agent);
      const process = hasAgentId || detected ? 'running' : await processLiveness(pane.pane_id, api);
      views.push({ paneId: pane.pane_id, terminalId: pane.terminal_id, workspaceId: pane.workspace_id, hasAgentId, detected, process });
    }

    const { close, sighted } = selectHerdrResiduePanes({ ownedWorkspaceIds, panes: views, previous: previousSightings });

    const closedKeys = new Set<string>();
    const actions: string[] = [];
    for (const pane of close) {
      try {
        await api.call('pane.close', { pane_id: pane.paneId });
      } catch {
        continue; // a failed close is skipped and not reported
      }
      closedKeys.add(residueKey(pane));
      actions.push(`closed idle shell pane ${pane.paneId} in workspace ${pane.workspaceId}`);
    }

    previousSightings = new Set([...sighted].filter((key) => !closedKeys.has(key)));

    if (actions.length > 0) {
      logDeaconEvent(`[herdr-residue-reaper] ${actions.join('; ')}`);
      emitActivityEntry({ source: 'cloister', level: 'warn', message: `Deacon closed ${actions.length} idle Herdr shell pane(s)` });
    }
    return actions;
  } catch {
    return [];
  }
}

/** A pane as `session.snapshot` reports it — the fields this module reads. */
interface ResidueRawPane {
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly workspace_id: string;
  readonly agent?: string | null;
  readonly tokens?: Record<string, string>;
}

/** Test seam: no production caller (PAN-3958 CH-8). */
export function _resetHerdrResidueSightingsForTests(): void {
  previousSightings = new Set();
}

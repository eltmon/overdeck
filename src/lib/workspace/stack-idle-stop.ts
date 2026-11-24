/**
 * PAN-5250 WI-6: the pure rules of the idle stop.
 *
 * - Targets (FR-2): the running containers of the workspace's exact compose
 *   project whose service is an idle-stop service. Never matched by name.
 * - In use (FR-3): measured facts only (D6). A live `work`, `review`, `plan`,
 *   `worker`, `strike` or `conversation` pane does not count; a `test` or
 *   `uat` pane does. Anything unreadable counts as in use (NFR-3).
 * - Idle clock (FR-4): issue id → when the workspace was first seen not in use.
 *   An in-use step clears it, so a new browser connection restarts the grace.
 */
import type { BackendPane } from '@overdeck/contracts';

import type { ComposeContainer } from './stack-reclaim-docker.js';
import type { ContainerUsageResult } from './stack-usage-probe.js';

export type IdleUseReason = 'browser' | 'exec-session' | 'test-agent' | 'verification' | 'gate-queue' | 'pinned' | 'probe-unknown';

export interface IdleUseFacts {
  targets: readonly ComposeContainer[];
  /** By container name. A target with no entry reads as 'unknown'. */
  usage: ReadonlyMap<string, ContainerUsageResult>;
  /** Already filtered to the issue with `issuePanes`. */
  panes: readonly BackendPane[];
  verificationBusy: boolean;
  inGateQueue: boolean;
  pinned: boolean;
}

const TEST_AGENT_ROLES: ReadonlySet<string> = new Set(['test', 'uat']);

/** FR-2 target selection: running, exact compose project, service in the idle set. */
export function idleStopTargets(
  running: readonly ComposeContainer[],
  composeProject: string,
  services: ReadonlySet<string>,
): ComposeContainer[] {
  return running.filter((container) =>
    container.state === 'running'
    && container.composeProject === composeProject
    && services.has(container.composeService));
}

/** FR-3, first matching reason in this order: pinned, test-agent, verification, gate-queue, probe-unknown, exec-session, browser; null when not in use. */
export function workspaceInUse(facts: IdleUseFacts): IdleUseReason | null {
  if (facts.pinned) return 'pinned';
  if (facts.panes.some((pane) => TEST_AGENT_ROLES.has(pane.role))) return 'test-agent';
  if (facts.verificationBusy) return 'verification';
  if (facts.inGateQueue) return 'gate-queue';
  const usage = facts.targets.map((target) => facts.usage.get(target.name) ?? 'unknown');
  if (usage.some((entry) => entry === 'unknown')) return 'probe-unknown';
  const known = usage.filter((entry): entry is Exclude<ContainerUsageResult, 'unknown'> => entry !== 'unknown');
  if (known.some((entry) => entry.execSessions > 0)) return 'exec-session';
  if (known.some((entry) => entry.inboundConnections > 0)) return 'browser';
  return null;
}

export type IdleClockStep =
  | { kind: 'in-use'; reason: IdleUseReason }
  | { kind: 'idle-started' }
  | { kind: 'idle-waiting'; idleMs: number }
  | { kind: 'due'; idleMs: number };

/** FR-4: mutates `clock` (issue id upper-case → first idle ms). */
export function advanceIdleClock(
  clock: Map<string, number>,
  issueId: string,
  inUse: IdleUseReason | null,
  now: number,
  idleLimitMs: number,
): IdleClockStep {
  const key = issueId.toUpperCase();
  if (inUse !== null) {
    clock.delete(key);
    return { kind: 'in-use', reason: inUse };
  }
  const since = clock.get(key);
  if (since === undefined) {
    clock.set(key, now);
    return { kind: 'idle-started' };
  }
  const idleMs = now - since;
  return idleMs >= idleLimitMs ? { kind: 'due', idleMs } : { kind: 'idle-waiting', idleMs };
}

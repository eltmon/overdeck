/**
 * Jira status mapping and transition choice (PAN-5152, FR-5, D-12, D-13).
 *
 * Jira does not let a client set a status directly: the client lists the
 * transitions available from the current status and posts the id of one.
 * These pure functions map a Jira status to Overdeck's canonical state on
 * read, and choose the transition that reaches a wanted state on write.
 * The status names come from the `state-mapping.ts` jira defaults merged
 * with the project's `jira.status_map`.
 */

import { CANONICAL_STATES, DEFAULT_STATE_MAPPINGS, type CanonicalState } from '../../core/state-mapping.js';
import type { JiraProjectConfig } from './jira-config.js';

/** A canonical state, plus `in_planning`, which writes only when the project maps it. */
export type JiraTransitionTarget = CanonicalState | 'in_planning';

/** A transition as `GET /issue/{key}/transitions` returns it. */
export interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string; statusCategory?: { key?: string } };
}

export type JiraStatusMap = Record<JiraTransitionTarget, string | undefined>;

export interface JiraAvailableTransition {
  id: string;
  name: string;
  toName: string;
}

export type JiraTransitionChoice =
  | { kind: 'already' }
  | { kind: 'transition'; id: string; toName: string }
  | { kind: 'no-transition'; wanted: string; available: JiraAvailableTransition[] };

/** The result of a Jira status write. Only `transitioned` and `already` move or confirm the issue. */
export type JiraTransitionOutcome =
  | { kind: 'transitioned'; message: string }
  | { kind: 'already'; message: string }
  | { kind: 'no-transition'; message: string }
  | { kind: 'error'; message: string };

const CATEGORY_TO_CANONICAL: Record<string, CanonicalState> = {
  new: 'todo',
  indeterminate: 'in_progress',
  done: 'done',
};

const CANONICAL_TO_CATEGORY: Partial<Record<JiraTransitionTarget, string>> = {
  todo: 'new',
  in_progress: 'indeterminate',
  done: 'done',
};

const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Merge the state-mapping jira defaults with the project's `jira.status_map`. */
export function jiraStatusMap(project?: JiraProjectConfig): JiraStatusMap {
  const defaults = DEFAULT_STATE_MAPPINGS.trackers.jira.stateMap;
  const map = { in_planning: undefined } as JiraStatusMap;
  for (const { name } of CANONICAL_STATES) {
    const entry = defaults[name];
    map[name] = typeof entry === 'string' ? entry : entry.status;
  }
  for (const [target, status] of Object.entries(project?.status_map ?? {})) {
    if (status) map[target as JiraTransitionTarget] = status;
  }
  return map;
}

/**
 * Map a Jira status to a canonical state (D-13): a case-insensitive name
 * match in the merged map (the first key in CANONICAL_STATES order wins),
 * else the status category, else `todo`.
 */
export function jiraStatusToCanonical(name: string, categoryKey: string | undefined, map: JiraStatusMap): CanonicalState {
  const byName = CANONICAL_STATES.find(state => same(map[state.name], name));
  if (byName) return byName.name;
  return (categoryKey && CATEGORY_TO_CANONICAL[categoryKey]) || 'todo';
}

/**
 * Choose the transition that reaches `target` from status `current` (D-12):
 * `already` when the current status is the wanted one; otherwise the
 * transition whose `to.name` is the wanted name; otherwise, for `todo`,
 * `in_progress` and `done` only, the single transition into the matching
 * status category; otherwise `no-transition`.
 */
export function pickJiraTransition(
  current: string,
  transitions: JiraTransition[],
  target: JiraTransitionTarget,
  map: JiraStatusMap,
): JiraTransitionChoice {
  const wanted = map[target];
  if (wanted === undefined || same(current, wanted)) return { kind: 'already' };

  const byName = transitions.find(transition => same(transition.to?.name, wanted));
  if (byName) return { kind: 'transition', id: byName.id, toName: byName.to?.name ?? wanted };

  const category = CANONICAL_TO_CATEGORY[target];
  if (category) {
    const byCategory = transitions.filter(transition => transition.to?.statusCategory?.key === category);
    if (byCategory.length === 1) {
      return { kind: 'transition', id: byCategory[0].id, toName: byCategory[0].to?.name ?? byCategory[0].name };
    }
  }

  return {
    kind: 'no-transition',
    wanted,
    available: transitions.map(transition => ({ id: transition.id, name: transition.name, toName: transition.to?.name ?? '' })),
  };
}

/** The log line for a `no-transition` choice. */
export function formatNoTransition(
  issueKey: string,
  choice: Extract<JiraTransitionChoice, { kind: 'no-transition' }>,
): string {
  const available = choice.available.length > 0
    ? choice.available.map(transition => `${transition.name} → ${transition.toName}`).join(', ')
    : 'none';
  return `Jira ${issueKey}: no transition reaches "${choice.wanted}" (available: ${available}); status left unchanged.`;
}

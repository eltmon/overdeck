/**
 * conversationGroups — pure grouping logic for the phone conversation list
 * (PAN-5045). Groups conversation rows by project the same way the desktop
 * does (`resolveEffectiveProjectKey`), falling back to raw `projectKey`
 * grouping when the registered-project list isn't available yet. Also holds
 * the localStorage round-trip for which project groups the phone has
 * expanded, since every group starts collapsed.
 */
import {
  NO_PROJECT_KEY,
  NO_PROJECT_LABEL,
  resolveEffectiveProjectKey,
  type FleetProjectIndex,
  type RegisteredProjectLite,
} from '../CommandDeck/projectsData';

export interface GroupableConversation {
  cwd?: string | null;
  projectKey?: string | null;
  origin?: string | null;
  gitOrigin?: string | null;
  createdAt: string;
  lastActivityAt?: string | null;
  lastAttachedAt?: string | null;
  archivedAt?: string | null;
}

export interface MobileConversationGroup<Row> {
  key: string;
  label: string;
  canCreate: boolean;
  rows: Row[];
}

export const EXPANDED_PROJECTS_STORAGE_KEY = 'pan-mobile-expanded-projects';

/** The phone groups with the local fleet index off: a linked machine's row is
 * grouped by its own `projectKey`/`cwd`, never combined by git origin. */
const NO_FLEET: FleetProjectIndex = { combine: false, localKeyByOrigin: new Map() };

export function recencyAt(row: GroupableConversation): string {
  return row.lastActivityAt ?? row.lastAttachedAt ?? row.createdAt;
}

function byRecencyDescending(a: GroupableConversation, b: GroupableConversation): number {
  return recencyAt(b).localeCompare(recencyAt(a));
}

export function groupMobileConversations<Row extends GroupableConversation>(
  rows: readonly Row[],
  registeredProjects: readonly RegisteredProjectLite[] | null,
): MobileConversationGroup<Row>[] {
  const live = rows.filter((row) => row.archivedAt == null);
  const noProjectRows: Row[] = [];
  const groups: MobileConversationGroup<Row>[] = [];

  if (registeredProjects) {
    const byKey = new Map<string, MobileConversationGroup<Row>>();
    for (const project of registeredProjects) {
      const group: MobileConversationGroup<Row> = {
        key: project.key,
        label: project.name || project.key,
        canCreate: true,
        rows: [],
      };
      byKey.set(project.key, group);
      groups.push(group);
    }
    for (const row of live) {
      const key = resolveEffectiveProjectKey(row, registeredProjects, NO_FLEET);
      const group = key ? byKey.get(key) : undefined;
      if (group) group.rows.push(row);
      else noProjectRows.push(row);
    }
  } else {
    const byKey = new Map<string, MobileConversationGroup<Row>>();
    for (const row of live) {
      const key = row.projectKey;
      if (!key) {
        noProjectRows.push(row);
        continue;
      }
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: key, canCreate: false, rows: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.rows.push(row);
    }
  }

  for (const group of groups) {
    group.rows.sort(byRecencyDescending);
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));

  if (noProjectRows.length > 0) {
    noProjectRows.sort(byRecencyDescending);
    groups.push({ key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL, canCreate: false, rows: noProjectRows });
  }

  return groups;
}

export function readExpandedProjects(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
      return new Set(parsed);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function writeExpandedProjects(keys: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Best-effort; the phone still works with every group collapsed.
  }
}

/**
 * Agents Directory tree and list shaping (PAN-3920 W5). Pure; no React.
 *
 * D5 — Tree: location → project → { issue nodes (issue number descending),
 * one "Conversations" node for the project's issue-less roots and their
 * descendants }. Agents are never tree nodes; they are list rows.
 * D6 — An entry belongs to (a) its issue node when it has an issue and (b) the
 * container of its root ancestor. In the list a child nests under its parent
 * when both are in the node; otherwise it is top level with "spawned by".
 */
import type { DirectoryEntry, DirectoryEntryState } from '@overdeck/contracts';

export type DirectoryNodeKind = 'location' | 'project' | 'issue' | 'conversations';

export interface DirectoryNode {
  /** 'loc:local' | 'proj:local:overdeck' | 'issue:local:PAN-3920' | 'convs:local:overdeck' */
  id: string;
  kind: DirectoryNodeKind;
  /** 'Local', 'Remote (Fly)', project key, issue id, 'Conversations' */
  label: string;
  /** An issue node's title from the tracker cache; null when unknown or not an issue node. */
  title: string | null;
  liveCount: number;
  totalCount: number;
  children: DirectoryNode[];
}

export interface DirectoryRow {
  entry: DirectoryEntry;
  /** Display depth, capped at 2 (PAN-4223 D22). */
  depth: number;
  spawnedByLabel: string | null;
  /** The real parent's label when the natural depth is deeper than 2 (D22). */
  flattenedFrom: string | null;
}

export const UNASSIGNED_PROJECT = 'unassigned';
const LOCATIONS = ['local', 'remote'] as const;

export const isLiveState = (state: DirectoryEntryState): boolean => state !== 'stopped' && state !== 'done';

export function locationNodeId(location: string): string { return `loc:${location}`; }
export function projectNodeId(location: string, projectKey: string): string { return `proj:${location}:${projectKey}`; }
export function issueNodeId(location: string, issueId: string): string { return `issue:${location}:${issueId}`; }
export function conversationsNodeId(location: string, projectKey: string): string { return `convs:${location}:${projectKey}`; }

const CLAUDE_SESSION_PARENT = 'claude-session:';

/**
 * What "spawned by" shows for a parent id: the parent entry's label when it is
 * listed, `Claude session <first 8>` for a `claude-session:<uuid>` parent (an
 * external agent's Claude parent Overdeck does not know), else the raw id.
 */
export function parentLabel(parentId: string, parent: DirectoryEntry | undefined): string {
  if (parent) return parent.label;
  if (parentId.startsWith(CLAUDE_SESSION_PARENT)) return `Claude session ${parentId.slice(CLAUDE_SESSION_PARENT.length, CLAUDE_SESSION_PARENT.length + 8)}`;
  return parentId;
}

export function projectLabel(projectKey: string): string {
  return projectKey === UNASSIGNED_PROJECT ? 'No project' : projectKey;
}

function timeOf(iso: string | null): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Live first, then last activity descending, then id. */
export function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  return Number(isLiveState(b.state)) - Number(isLiveState(a.state))
    || timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt)
    || a.id.localeCompare(b.id);
}

function issueNumber(issueId: string): number {
  const match = /(\d+)\s*$/.exec(issueId);
  return match ? Number.parseInt(match[1]!, 10) : -1;
}

function rootOf(entry: DirectoryEntry, byId: ReadonlyMap<string, DirectoryEntry>): DirectoryEntry {
  let current = entry;
  const seen = new Set<string>([entry.id]);
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

/** The leaf node ids (issue / conversations) an entry is listed under (D6). */
export function leafNodesOf(entry: DirectoryEntry, byId: ReadonlyMap<string, DirectoryEntry>): string[] {
  const nodes = new Set<string>();
  if (entry.issueId) nodes.add(issueNodeId(entry.location, entry.issueId));
  const root = rootOf(entry, byId);
  nodes.add(root.issueId
    ? issueNodeId(root.location, root.issueId)
    : conversationsNodeId(root.location, root.projectKey));
  return [...nodes];
}

interface LeafInfo {
  kind: 'issue' | 'conversations';
  location: string;
  projectKey: string;
  label: string;
  title: string | null;
  ids: Set<string>;
}

function leafIndex(entries: readonly DirectoryEntry[]): Map<string, LeafInfo> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const leaves = new Map<string, LeafInfo>();
  for (const entry of entries) {
    const root = rootOf(entry, byId);
    for (const nodeId of leafNodesOf(entry, byId)) {
      let leaf = leaves.get(nodeId);
      if (!leaf) {
        const isIssue = nodeId.startsWith('issue:');
        // An issue node lives in the project of the entry that names the issue.
        const owner = isIssue && entry.issueId && nodeId === issueNodeId(entry.location, entry.issueId) ? entry : root;
        leaf = {
          kind: isIssue ? 'issue' : 'conversations',
          location: owner.location,
          projectKey: owner.projectKey,
          label: isIssue ? nodeId.slice(`issue:${owner.location}:`.length) : 'Conversations',
          title: null,
          ids: new Set(),
        };
        leaves.set(nodeId, leaf);
      }
      if (leaf.kind === 'issue' && !leaf.title && entry.issueTitle && entry.issueId === leaf.label) leaf.title = entry.issueTitle;
      leaf.ids.add(entry.id);
    }
  }
  return leaves;
}

function counts(ids: ReadonlySet<string>, byId: ReadonlyMap<string, DirectoryEntry>): { liveCount: number; totalCount: number } {
  let liveCount = 0;
  for (const id of ids) if (byId.get(id) && isLiveState(byId.get(id)!.state)) liveCount++;
  return { liveCount, totalCount: ids.size };
}

export function buildDirectoryTree(entries: readonly DirectoryEntry[]): DirectoryNode[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const leaves = leafIndex(entries);
  const tree: DirectoryNode[] = [];

  for (const location of LOCATIONS) {
    const locationLeaves = [...leaves.entries()].filter(([, leaf]) => leaf.location === location);
    if (locationLeaves.length === 0 && location !== 'local') continue;

    const projectKeys = [...new Set(locationLeaves.map(([, leaf]) => leaf.projectKey))].sort((a, b) => {
      if (a === UNASSIGNED_PROJECT) return 1;
      if (b === UNASSIGNED_PROJECT) return -1;
      return a.localeCompare(b);
    });
    const locationIds = new Set<string>();
    const projects: DirectoryNode[] = projectKeys.map((projectKey) => {
      const projectLeaves = locationLeaves.filter(([, leaf]) => leaf.projectKey === projectKey);
      const projectIds = new Set<string>();
      const issueNodes = projectLeaves
        .filter(([, leaf]) => leaf.kind === 'issue')
        .sort(([, a], [, b]) => issueNumber(b.label) - issueNumber(a.label) || a.label.localeCompare(b.label));
      const convNodes = projectLeaves.filter(([, leaf]) => leaf.kind === 'conversations');
      const children = [...issueNodes, ...convNodes].map(([id, leaf]) => {
        for (const entryId of leaf.ids) { projectIds.add(entryId); locationIds.add(entryId); }
        return { id, kind: leaf.kind, label: leaf.label, title: leaf.title, ...counts(leaf.ids, byId), children: [] } satisfies DirectoryNode;
      });
      return {
        id: projectNodeId(location, projectKey),
        kind: 'project' as const,
        label: projectLabel(projectKey),
        title: null,
        ...counts(projectIds, byId),
        children,
      };
    });
    tree.push({
      id: locationNodeId(location),
      kind: 'location',
      label: location === 'local' ? 'Local' : 'Remote (Fly)',
      title: null,
      ...counts(locationIds, byId),
      children: projects,
    });
  }
  return tree;
}

/** Every entry id listed under a node: a leaf's members, or the union beneath a location/project. */
function memberIds(entries: readonly DirectoryEntry[], nodeId: string): Set<string> {
  const leaves = leafIndex(entries);
  const direct = leaves.get(nodeId);
  if (direct) return direct.ids;
  const ids = new Set<string>();
  for (const [, leaf] of leaves) {
    const inLocation = nodeId === locationNodeId(leaf.location);
    const inProject = nodeId === projectNodeId(leaf.location, leaf.projectKey);
    if (inLocation || inProject) for (const id of leaf.ids) ids.add(id);
  }
  return ids;
}

export function entriesForNode(entries: readonly DirectoryEntry[], nodeId: string): DirectoryRow[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const members = memberIds(entries, nodeId);
  const inNode = entries.filter((entry) => members.has(entry.id));
  const childrenOf = new Map<string, DirectoryEntry[]>();
  const tops: DirectoryEntry[] = [];
  for (const entry of inNode) {
    if (entry.parentId && members.has(entry.parentId) && entry.parentId !== entry.id) {
      const siblings = childrenOf.get(entry.parentId) ?? [];
      siblings.push(entry);
      childrenOf.set(entry.parentId, siblings);
    } else {
      tops.push(entry);
    }
  }

  const rows: DirectoryRow[] = [];
  const visited = new Set<string>();
  const visit = (entry: DirectoryEntry, depth: number) => {
    if (visited.has(entry.id)) return;
    visited.add(entry.id);
    const parent = depth === 0 && entry.parentId ? byId.get(entry.parentId) : undefined;
    rows.push({
      entry,
      depth: Math.min(depth, 2),
      spawnedByLabel: depth === 0 && entry.parentId ? parentLabel(entry.parentId, parent) : null,
      flattenedFrom: depth > 2 && entry.parentId ? parentLabel(entry.parentId, byId.get(entry.parentId)) : null,
    });
    for (const child of [...(childrenOf.get(entry.id) ?? [])].sort(compareEntries)) visit(child, depth + 1);
  };
  for (const top of [...tops].sort(compareEntries)) visit(top, 0);
  return rows;
}

/** Case-insensitive match over label, id, harness, model and role. */
export function filterRows(rows: readonly DirectoryRow[], query: string): DirectoryRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(({ entry }) => [entry.label, entry.id, entry.harness, entry.model, entry.role ?? '']
    .some((field) => field.toLowerCase().includes(needle)));
}

/** Tree nodes in display order, depth-first, skipping children of collapsed nodes. */
export function visibleNodes(tree: readonly DirectoryNode[], collapsed: ReadonlySet<string>): Array<{ node: DirectoryNode; depth: number }> {
  const out: Array<{ node: DirectoryNode; depth: number }> = [];
  const walk = (nodes: readonly DirectoryNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (!collapsed.has(node.id)) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

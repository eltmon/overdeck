/**
 * The Command Deck conversation tree (.pan/drafts/pan-4223.md WI-10 step 2,
 * FR-26, FR-28, D6, D18, D22).
 *
 * Every row whose parent link names a row in the list nests under it: lanes
 * under their launcher, successors under their predecessor. The lane columns
 * play no part in nesting. Rows render in pre-order at display depth
 * min(natural depth, 2); a deeper row keeps its pre-order position and names
 * its real parent through `flattenedFrom`. A top-level group sits where its
 * best member would sit in the flat list order, so an ended predecessor with
 * a live successor ranks with the successor.
 */
import type { Conversation } from './ConversationList';

export interface ConversationTreeNode {
  conv: Conversation;
  /** Display depth, min(naturalDepth, 2) (D22). */
  depth: 0 | 1 | 2;
  naturalDepth: number;
  /** Top-level nodes only: every descendant in pre-order, each at its display depth. Empty below the top level. */
  descendants: ConversationTreeNode[];
  /** Parent id when the row has a parent link but the parent is not in `rows` (rendered top level, D6). */
  orphanOf: number | null;
  /** Parent id when naturalDepth > 2 (rendered at depth 2 with a marker, D22). */
  flattenedFrom: number | null;
}

export interface ConversationGroupSummary {
  lanes: number;
  successors: number;
  working: number;
  needsYou: number;
  reported: number;
}

/** The flat list's live predicate (ConversationList `isActive`). */
export function isConversationActive(conv: Conversation): boolean {
  return Boolean(conv.sessionAlive || (conv.forkStatus && conv.forkStatus !== 'failed'));
}

function siblingOrder(a: Conversation, b: Conversation): number {
  const live = Number(isConversationActive(b)) - Number(isConversationActive(a));
  if (live !== 0) return live;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/** Nest every row whose parent link names a row in `rows` (lanes and successors alike); cap display depth at 2. */
export function buildConversationTree(rows: readonly Conversation[]): ConversationTreeNode[] {
  const indexById = new Map<number, number>();
  rows.forEach((conv, index) => { if (!indexById.has(conv.id)) indexById.set(conv.id, index); });
  const children = new Map<number, Conversation[]>();
  for (const conv of rows) {
    const parentId = conv.parentConversationId ?? null;
    if (parentId !== null && parentId !== conv.id && indexById.has(parentId)) {
      const siblings = children.get(parentId) ?? [];
      siblings.push(conv);
      children.set(parentId, siblings);
    }
  }
  for (const siblings of children.values()) siblings.sort(siblingOrder);

  const visited = new Set<number>();
  const walk = (conv: Conversation, naturalDepth: number, into: ConversationTreeNode[]): void => {
    for (const child of children.get(conv.id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const depth = Math.min(naturalDepth, 2) as 1 | 2;
      into.push({
        conv: child,
        depth,
        naturalDepth,
        descendants: [],
        orphanOf: null,
        flattenedFrom: naturalDepth > 2 ? (child.parentConversationId ?? null) : null,
      });
      walk(child, naturalDepth + 1, into);
    }
  };
  const top = (conv: Conversation, orphanOf: number | null): { node: ConversationTreeNode; rank: number } => {
    visited.add(conv.id);
    const descendants: ConversationTreeNode[] = [];
    walk(conv, 1, descendants);
    const rank = Math.min(indexById.get(conv.id) ?? Infinity, ...descendants.map((node) => indexById.get(node.conv.id) ?? Infinity));
    return { node: { conv, depth: 0, naturalDepth: 0, descendants, orphanOf, flattenedFrom: null }, rank };
  };

  const groups: Array<{ node: ConversationTreeNode; rank: number }> = [];
  for (const conv of rows) {
    if (visited.has(conv.id)) continue;
    const parentId = conv.parentConversationId ?? null;
    if (parentId !== null && parentId !== conv.id && indexById.has(parentId)) continue;
    groups.push(top(conv, parentId !== null && parentId !== conv.id ? parentId : null));
  }
  // Guard: a hand-built parent cycle has no root; list its rows at top level once each.
  for (const conv of rows) {
    if (!visited.has(conv.id)) groups.push(top(conv, null));
  }
  return groups.sort((a, b) => a.rank - b.rank).map((group) => group.node);
}

export function groupSummary(node: ConversationTreeNode): ConversationGroupSummary {
  const summary: ConversationGroupSummary = { lanes: 0, successors: 0, working: 0, needsYou: 0, reported: 0 };
  for (const { conv } of node.descendants) {
    if (conv.laneKey) {
      summary.lanes += 1;
      if (conv.laneReport) summary.reported += 1;
    } else {
      summary.successors += 1;
    }
    if (conv.isWorking) summary.working += 1;
    if ((conv.pendingInputCount ?? 0) > 0) summary.needsYou += 1;
  }
  return summary;
}

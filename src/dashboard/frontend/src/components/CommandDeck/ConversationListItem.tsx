/**
 * One top-level entry of the conversation list: the row, its group toggle and
 * its nested rows (PAN-4560).
 *
 * `buildConversationTree` rebuilds every node on each list poll, but the query
 * cache keeps unchanged conversation objects identical. `itemPropsEqual`
 * compares what the item renders — the conversations by reference, the tree
 * markers and each row's selected state — so a poll in which one
 * conversation changed re-renders only that conversation's item.
 */
import { memo } from 'react';
import { motion } from 'framer-motion';
import { ConversationRow } from './ConversationRow';
import { groupSummary, type ConversationTreeNode } from './conversation-tree';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import styles from './styles/command-deck.module.css';

type RegisteredProject = React.ComponentProps<typeof ConversationRow>['registeredProjects'];

export interface ConversationListItemProps {
  node: ConversationTreeNode<Conversation>;
  collapsed: boolean;
  selectedConversation: string | null;
  onSelectConversation: (name: string) => void;
  onToggleGroup: (node: ConversationTreeNode<Conversation>) => void;
  mutations: ConversationMutations;
  registeredProjects: RegisteredProject;
}

/** The non-zero group counts, in the order the PRD fixes (WI-10 step 3). */
function groupSummaryText(node: ConversationTreeNode<Conversation>): string {
  const summary = groupSummary(node);
  const parts: string[] = [];
  if (summary.successors > 0) parts.push(`${summary.successors} ${summary.successors === 1 ? 'successor' : 'successors'}`);
  if (summary.lanes > 0) parts.push(`${summary.lanes} ${summary.lanes === 1 ? 'lane' : 'lanes'}`);
  if (summary.working > 0) parts.push(`${summary.working} working`);
  if (summary.needsYou > 0) parts.push(`${summary.needsYou} needs you`);
  if (summary.reported > 0) parts.push(`${summary.reported} reported`);
  return parts.join(' · ');
}

function ConversationListItemImpl({
  node,
  collapsed,
  selectedConversation,
  onSelectConversation,
  onToggleGroup,
  mutations,
  registeredProjects,
}: ConversationListItemProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      <ConversationRow
        conv={node.conv}
        isSelected={selectedConversation === node.conv.name}
        onSelect={onSelectConversation}
        mutations={mutations}
        registeredProjects={registeredProjects}
        orphanOf={node.orphanOf}
      />
      {node.descendants.length > 0 && (
        <button
          type="button"
          className={styles.convGroupToggle}
          aria-expanded={!collapsed}
          onClick={() => onToggleGroup(node)}
        >
          {`${collapsed ? '▸' : '▾'} ${groupSummaryText(node)}`}
        </button>
      )}
      {!collapsed && node.descendants.map((child) => (
        <div
          key={child.conv.id}
          className={child.depth === 2 ? styles.convTreeDepth2 : styles.convTreeDepth1}
        >
          <ConversationRow
            conv={child.conv}
            variant="nested"
            isSelected={selectedConversation === child.conv.name}
            onSelect={onSelectConversation}
            mutations={mutations}
            registeredProjects={registeredProjects}
            flattenedFrom={child.flattenedFrom}
            criticOf={child.criticOf}
          />
        </div>
      ))}
    </motion.div>
  );
}

export function itemPropsEqual(a: ConversationListItemProps, b: ConversationListItemProps): boolean {
  if (a.node.conv !== b.node.conv || a.node.orphanOf !== b.node.orphanOf) return false;
  if (a.collapsed !== b.collapsed) return false;
  if ((a.selectedConversation === a.node.conv.name) !== (b.selectedConversation === b.node.conv.name)) return false;
  if (a.node.descendants.length !== b.node.descendants.length) return false;
  for (let i = 0; i < a.node.descendants.length; i += 1) {
    const prev = a.node.descendants[i]!;
    const next = b.node.descendants[i]!;
    if (prev.conv !== next.conv || prev.depth !== next.depth) return false;
    if (prev.flattenedFrom !== next.flattenedFrom || prev.criticOf !== next.criticOf) return false;
    if ((a.selectedConversation === prev.conv.name) !== (b.selectedConversation === next.conv.name)) return false;
  }
  return (
    Object.is(a.onSelectConversation, b.onSelectConversation)
    && Object.is(a.onToggleGroup, b.onToggleGroup)
    && Object.is(a.mutations, b.mutations)
    && Object.is(a.registeredProjects, b.registeredProjects)
  );
}

export const ConversationListItem = memo(ConversationListItemImpl, itemPropsEqual);

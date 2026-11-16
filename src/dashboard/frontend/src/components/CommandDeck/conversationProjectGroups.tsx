/**
 * conversationProjectGroups — the All projects list's per-project groups
 * (PAN-5343 H-D3).
 *
 * In the All projects deck the Inbox rows render under one header per
 * project: the project mark, its name and, right-aligned, "N working" or
 * "idle". Groups sort by name, case-insensitive; conversations under no
 * registered project come last under "No project". A handoff tree groups
 * under its root conversation's project. The headers do not collapse.
 */
import { ProjectMark } from '../frame/ProjectMark';
import { NO_PROJECT_KEY } from './projectsData';
import styles from './styles/command-deck.module.css';

/** The project a conversation is grouped under. */
export interface ConversationProjectRef {
  key: string;
  label: string;
}

export interface ProjectGroup<N> {
  key: string;
  label: string;
  nodes: N[];
  /** Root conversations in the group with an agent at work. */
  working: number;
}

/** Group top-level nodes by their root conversation's project, in H-D3 order. */
export function groupNodesByProject<N extends { conv: C }, C extends { isWorking?: boolean }>(
  nodes: readonly N[],
  groupOf: (conv: C) => ConversationProjectRef,
): ProjectGroup<N>[] {
  const byKey = new Map<string, ProjectGroup<N>>();
  for (const node of nodes) {
    const { key, label } = groupOf(node.conv);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, nodes: [], working: 0 };
      byKey.set(key, group);
    }
    group.nodes.push(node);
    if (node.conv.isWorking === true) group.working += 1;
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === NO_PROJECT_KEY) return b.key === NO_PROJECT_KEY ? 0 : 1;
    if (b.key === NO_PROJECT_KEY) return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}

/** One project's header in the grouped Inbox. Not collapsible. */
export function ProjectGroupHeader({ projectKey, label, working }: { projectKey: string; label: string; working: number }) {
  return (
    <div
      className={styles.convSectionHeader}
      role="heading"
      aria-level={3}
      data-section="inbox"
      data-project-group={projectKey}
      data-testid={`conversation-project-group-${projectKey}`}
    >
      <ProjectMark size="sm" name={label} projectKey={projectKey} muted={projectKey === NO_PROJECT_KEY} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={styles.convSectionCount}>{working > 0 ? `${working} working` : 'idle'}</span>
    </div>
  );
}

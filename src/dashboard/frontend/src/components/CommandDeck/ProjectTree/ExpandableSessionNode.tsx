import { useState } from 'react';
import { ActiveAgentPanel } from '../../issue-view/ActiveAgentPanel';
import { SessionNode, type SessionNodeProps } from './SessionNode';
import styles from '../styles/command-deck.module.css';

export type ExpandableSessionNodeProps = Omit<SessionNodeProps, 'expandable' | 'expanded' | 'onToggleExpand'>;

export function ExpandableSessionNode(props: ExpandableSessionNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isExpandable = props.session.type === 'work' || props.session.type === 'strike';

  return (
    <div>
      <SessionNode
        {...props}
        expandable={isExpandable}
        expanded={expanded}
        onToggleExpand={() => setExpanded((prev) => !prev)}
      />
      {expanded && isExpandable && (
        <div className={styles.sessionChildList}>
          <ActiveAgentPanel agentId={props.session.sessionId} density="rail" />
        </div>
      )}
    </div>
  );
}

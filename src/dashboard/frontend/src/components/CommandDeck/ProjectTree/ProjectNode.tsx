import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SessionNode } from '@panopticon/contracts';
import { FeatureItem, type TreeSessionFilter } from './FeatureItem';
import styles from '../styles/command-deck.module.css';

export interface ProjectFeature {
  issueId: string;
  title: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  cost?: number;
  isRally?: boolean;
  childCount?: number;
  completedCount?: number;
  inProgressCount?: number;
  rawTrackerState?: string;
  readyForMerge?: boolean;
  sessions?: SessionNode[];
}

interface ProjectNodeProps {
  name: string;
  features: ProjectFeature[];
  selectedFeature: string | null;
  onSelectFeature: (issueId: string) => void;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  issueTitles?: Record<string, string>;
  issueCosts?: Record<string, number>;
  filter?: TreeSessionFilter;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
}

export function ProjectNode({ name, features, selectedFeature, onSelectFeature, selectedSessionId, onSelectSession, issueTitles, issueCosts, filter, onStopSession, onViewTerminal }: ProjectNodeProps) {
  const [expanded, setExpanded] = useState(features.length > 0);

  return (
    <div className={styles.projectNode}>
      <button
        className={styles.projectHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          size={14}
        />
        <span className={styles.projectName}>{name}</span>
        <span className={styles.featureCount}>{features.length}</span>
      </button>

      {expanded && (
        features.length > 0 ? (
          features.map(feature => (
            <FeatureItem
              key={feature.issueId}
              feature={feature}
              isSelected={selectedFeature === feature.issueId}
              onSelect={() => onSelectFeature(feature.issueId)}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              title={issueTitles?.[feature.issueId.toLowerCase()] || issueTitles?.[feature.issueId] || feature.title}
              cost={issueCosts?.[feature.issueId.toLowerCase()] || issueCosts?.[feature.issueId]}
              filter={filter}
              onStopSession={onStopSession}
              onViewTerminal={onViewTerminal}
            />
          ))
        ) : (
          <div className={styles.emptyProject}>(no active features)</div>
        )
      )}
    </div>
  );
}

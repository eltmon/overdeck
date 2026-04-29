import { useQuery } from '@tanstack/react-query';
import { AgentSection } from './AgentSection';
import { IsolationMode } from './IsolationMode';
import { useState, useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Issue } from '../../../types';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import styles from '../styles/command-deck.module.css';

interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript: string;
  /** tmux session name to stream live — present when status is 'running' */
  tmuxSession?: string;
}

interface CostByStage {
  [stage: string]: { cost: number; tokens: number };
}

interface ActivityViewProps {
  issueId: string;
  issues?: Issue[];
  featureData?: ProjectFeature | null;
}

async function fetchActivity(issueId: string): Promise<{ issueId: string; sections: ActivitySection[]; costByStage?: CostByStage; totalCost?: number }> {
  const res = await fetch(`/api/command-deck/activity/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json();
}

function statusDotColor(status: string): string {
  if (status === 'Done' || status === 'Completed' || status === 'Closed') return 'var(--success)';
  if (status === 'In Progress' || status === 'Started' || status === 'Active') return 'var(--warning)';
  if (status === 'In Review' || status === 'Review' || status === 'QA' || status === 'Testing') return '#ec4899';
  return 'var(--muted-foreground)';
}

function RallyStoriesSection({ feature, issues }: { feature: ProjectFeature; issues: Issue[] }) {
  const childStories = issues.filter(i =>
    i.source === 'rally' && i.parentRef === feature.issueId
  );
  const parentIssue = issues.find(i =>
    i.source === 'rally' && i.identifier === feature.issueId
  );

  if (childStories.length === 0 && !parentIssue) return null;

  const completedCount = feature.completedCount || 0;
  const totalCount = feature.childCount || childStories.length;
  const inProgressCount = feature.inProgressCount || 0;
  const progressPct = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Feature Summary Card */}
      <div style={{
        background: 'var(--muted)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid #6366f1',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '12px' }}>
            {feature.issueId}
          </span>
          {parentIssue?.url && (
            <a href={parentIssue.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted-foreground)' }}>
              <ExternalLink size={12} />
            </a>
          )}
          {feature.rawTrackerState && (
            <span style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgba(107,114,128,0.15)',
              color: 'var(--muted-foreground)',
            }}>
              Rally: {feature.rawTrackerState}
            </span>
          )}
          {feature.stateLabel && feature.stateLabel !== feature.rawTrackerState && (
            <span style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 3,
              background: feature.stateLabel === 'In Progress' ? 'rgba(168,85,247,0.15)' : 'rgba(34,197,94,0.15)',
              color: feature.stateLabel === 'In Progress' ? '#a855f7' : '#22c55e',
            }}>
              Derived: {feature.stateLabel}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1,
              height: 6,
              background: 'var(--border)',
              borderRadius: 3,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressPct}%`,
                height: '100%',
                background: progressPct === 100 ? 'var(--success)' : '#6366f1',
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
              {completedCount}/{totalCount} done{inProgressCount > 0 ? `, ${inProgressCount} active` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Child Stories Table */}
      {childStories.length > 0 && (
        <div style={{
          background: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            User Stories ({childStories.length})
          </div>
          {childStories.map(story => (
            <div
              key={story.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid var(--border)',
                fontSize: '12px',
              }}
            >
              {/* Status dot */}
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: statusDotColor(story.status),
                flexShrink: 0,
              }} />

              {/* Identifier + link */}
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#6366f1',
                  textDecoration: 'none',
                  fontFamily: "'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                {story.identifier}
              </a>

              {/* Title */}
              <span style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--foreground)',
              }}>
                {story.title}
              </span>

              {/* Assignee */}
              {story.assignee?.name && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground)',
                  flexShrink: 0,
                }}>
                  {story.assignee.name}
                </span>
              )}

              {/* Rally state badge */}
              {story.rawTrackerState && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'rgba(107,114,128,0.12)',
                  color: 'var(--muted-foreground)',
                  flexShrink: 0,
                }}>
                  {story.rawTrackerState}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityView({ issueId, issues = [], featureData }: ActivityViewProps) {
  const [isolatedSection, setIsolatedSection] = useState<ActivitySection | null>(null);
  const [readSections, setReadSections] = useState<Set<string>>(new Set());
  const prevSectionsRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['command-deck-activity', issueId],
    queryFn: () => fetchActivity(issueId),
    refetchInterval: 5000,
  });

  const sections = data?.sections || [];
  const costByStage = data?.costByStage || {};
  const totalCost = data?.totalCost || 0;

  // Track new/unread sections
  useEffect(() => {
    const currentIds = sections.map(s => s.sessionId);
    const newIds = currentIds.filter(id => !prevSectionsRef.current.includes(id));

    if (newIds.length > 0 && prevSectionsRef.current.length > 0) {
      // Don't mark as unread on initial load
      setReadSections(prev => {
        const next = new Set(prev);
        // existing ones stay read, new ones are unread
        return next;
      });
    }

    prevSectionsRef.current = currentIds;
  }, [sections]);

  const handleSectionClick = (section: ActivitySection) => {
    setIsolatedSection(section);
    setReadSections(prev => new Set([...prev, section.sessionId]));
  };

  const handleCloseIsolation = () => {
    setIsolatedSection(null);
  };

  // Scroll to bottom once when switching to a new feature (after sections load)
  const prevIssueRef = useRef<string | null>(null);
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (prevIssueRef.current !== issueId) {
      prevIssueRef.current = issueId;
      hasScrolledRef.current = false;
    }
    if (sections.length > 0 && containerRef.current && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      // Use rAF to ensure DOM has rendered the content before measuring scroll height
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
      });
    }
  }, [issueId, sections]);

  // Escape key to close isolation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isolatedSection) {
        handleCloseIsolation();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isolatedSection]);

  if (isLoading && sections.length === 0) {
    return (
      <div className={styles.activityContainer}>
        <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>
          Loading activity...
        </div>
      </div>
    );
  }

  if (sections.length === 0) {
    // Still show Rally stories even without agent activity
    const isRally = featureData?.isRally === true;
    return (
      <div className={styles.activityContainer}>
        {isRally && featureData && (
          <RallyStoriesSection feature={featureData} issues={issues} />
        )}
        <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>
          No agent activity yet for this feature.
        </div>
      </div>
    );
  }

  // Check if selected feature is a Rally Feature
  const isRallyFeature = featureData?.isRally === true;

  return (
    <>
      <div ref={containerRef} className={styles.activityContainer}>
        {/* Rally Feature: show stories section at top */}
        {isRallyFeature && featureData && (
          <RallyStoriesSection feature={featureData} issues={issues} />
        )}

        {totalCost > 0 && (
          <div className={styles.costSummary}>
            Total: ${totalCost < 0.01 ? '<0.01' : totalCost.toFixed(2)}
          </div>
        )}
        {sections.map((section, index) => {
          // Map section type to cost stage key(s)
          const stageKeys: Record<string, string[]> = {
            work: ['implementation'],
            review: ['review'],
            test: ['test'],
            merge: ['merge'],
          };
          const keys = stageKeys[section.type] || [section.type];
          const sectionCost = keys.reduce((sum, k) => sum + (costByStage[k]?.cost || 0), 0) || undefined;

          // Auto-expand: running sections + the most recent section
          const isLast = index === sections.length - 1;
          const shouldExpand = section.status === 'running' || isLast;

          return (
            <AgentSection
              key={section.sessionId}
              section={section}
              isUnread={!readSections.has(section.sessionId) && prevSectionsRef.current.length > 0}
              onClick={() => handleSectionClick(section)}
              cost={sectionCost}
              defaultExpanded={shouldExpand}
            />
          );
        })}
      </div>

      {isolatedSection && (
        <IsolationMode
          section={isolatedSection}
          onClose={handleCloseIsolation}
        />
      )}
    </>
  );
}

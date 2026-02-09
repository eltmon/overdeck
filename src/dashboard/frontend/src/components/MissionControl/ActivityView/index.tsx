import { useQuery } from '@tanstack/react-query';
import { AgentSection } from './AgentSection';
import { IsolationMode } from './IsolationMode';
import { useState, useEffect, useRef } from 'react';
import styles from '../styles/mission-control.module.css';

interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript: string;
}

interface ActivityViewProps {
  issueId: string;
}

async function fetchActivity(issueId: string): Promise<{ issueId: string; sections: ActivitySection[] }> {
  const res = await fetch(`/api/mission-control/activity/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json();
}

export function ActivityView({ issueId }: ActivityViewProps) {
  const [isolatedSection, setIsolatedSection] = useState<ActivitySection | null>(null);
  const [readSections, setReadSections] = useState<Set<string>>(new Set());
  const prevSectionsRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mission-control-activity', issueId],
    queryFn: () => fetchActivity(issueId),
    refetchInterval: 5000,
  });

  const sections = data?.sections || [];

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

  // Scroll to bottom on initial load and issueId change
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [issueId]);

  useEffect(() => {
    if (sections.length > 0 && containerRef.current && !hasScrolledRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      hasScrolledRef.current = true;
    }
  }, [sections]);

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
        <div style={{ color: 'var(--mc-text-muted)', fontSize: 'var(--mc-font-size-sm)' }}>
          Loading activity...
        </div>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className={styles.activityContainer}>
        <div style={{ color: 'var(--mc-text-muted)', fontSize: 'var(--mc-font-size-sm)' }}>
          No agent activity yet for this feature.
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className={styles.activityContainer}>
        {sections.map((section) => (
          <AgentSection
            key={section.sessionId}
            section={section}
            isUnread={!readSections.has(section.sessionId) && prevSectionsRef.current.length > 0}
            onClick={() => handleSectionClick(section)}
          />
        ))}
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

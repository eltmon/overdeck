import { useState, useEffect } from 'react';
import { List, GitBranch, Code2 } from 'lucide-react';
import type { VBriefDocument } from './types';
import { VBriefHeader } from './VBriefHeader';
import { VBriefNarratives } from './VBriefNarratives';
import { VBriefReferences } from './VBriefReferences';
import { VBriefItemList } from './VBriefItemList';

export type VBriefViewTab = 'list' | 'dag' | 'raw';

const STORAGE_KEY = 'vbrief-viewer-tab';

const TABS: { id: VBriefViewTab; label: string; Icon: React.ElementType }[] = [
  { id: 'list', label: 'List', Icon: List },
  { id: 'dag', label: 'DAG', Icon: GitBranch },
  { id: 'raw', label: 'Raw JSON', Icon: Code2 },
];

interface VBriefViewerProps {
  doc: VBriefDocument | null;
  /** Optional override for active tab */
  initialTab?: VBriefViewTab;
}

export function VBriefViewer({ doc, initialTab }: VBriefViewerProps) {
  const [tab, setTab] = useState<VBriefViewTab>(() => {
    if (initialTab) return initialTab;
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as VBriefViewTab | null) ?? 'list';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, tab);
  }, [tab]);

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No plan available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card text-foreground overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-muted-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content — DAG tab needs overflow-hidden so ReactFlow gets a real height */}
      <div className={`flex-1 ${tab === 'dag' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {tab === 'list' && (
          <>
            <VBriefHeader doc={doc} />
            {doc.plan.narratives && <VBriefNarratives narratives={doc.plan.narratives} />}
            {doc.plan.references && doc.plan.references.length > 0 && (
              <VBriefReferences references={doc.plan.references} />
            )}
            <VBriefItemList items={doc.plan.items} />
          </>
        )}

        {tab === 'dag' && (
          <div className="h-full">
            <DAGPlaceholder issueId={doc.plan.id} />
          </div>
        )}

        {tab === 'raw' && (
          <pre className="p-4 text-xs text-success font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(doc, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Lazy-load PlanDAGViewer to avoid bundling ReactFlow unless needed */
function DAGPlaceholder({ issueId }: { issueId: string }) {
  const [DAGViewer, setDAGViewer] = useState<React.ComponentType<{ issueId: string }> | null>(null);

  useEffect(() => {
    import('../PlanDAG.js').then(m => {
      setDAGViewer(() => m.PlanDAGViewer);
    }).catch(() => {/* PlanDAG unavailable */});
  }, []);

  if (!DAGViewer) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        Loading DAG...
      </div>
    );
  }

  return <DAGViewer issueId={issueId} />;
}

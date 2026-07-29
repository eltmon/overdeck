import { useState, useEffect } from 'react';
import { List, GitBranch, Code2 } from 'lucide-react';
import type { XBriefDocument, XBriefInspectionPolicy } from './types';
import { XBriefHeader } from './XBriefHeader';
import { XBriefNarratives } from './XBriefNarratives';
import { XBriefReferences } from './XBriefReferences';
import { XBriefItemList } from './XBriefItemList';
import { XBriefReadinessPanel } from './XBriefReadinessPanel';

export type XBriefViewTab = 'list' | 'dag' | 'raw';

const STORAGE_KEY = 'xbrief-viewer-tab';

const TABS: { id: XBriefViewTab; label: string; Icon: React.ElementType }[] = [
  { id: 'list', label: 'List', Icon: List },
  { id: 'dag', label: 'DAG', Icon: GitBranch },
  { id: 'raw', label: 'Raw JSON', Icon: Code2 },
];

interface XBriefViewerProps {
  doc: XBriefDocument | null;
  /** Optional override for active tab */
  initialTab?: XBriefViewTab;
  onInspectionPolicyChange?: (policy: XBriefInspectionPolicy) => void;
  isUpdatingInspectionPolicy?: boolean;
}

export function XBriefViewer({ doc, initialTab, onInspectionPolicyChange, isUpdatingInspectionPolicy = false }: XBriefViewerProps) {
  const [tab, setTab] = useState<XBriefViewTab>(() => {
    if (initialTab) return initialTab;
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as XBriefViewTab | null) ?? 'list';
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
      <div className={`flex-1 min-h-0 ${tab === 'dag' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
        {tab === 'list' && (
          <>
            <XBriefHeader
              doc={doc}
              onInspectionPolicyChange={onInspectionPolicyChange}
              isUpdatingInspectionPolicy={isUpdatingInspectionPolicy}
            />
            {doc.plan.narratives && <XBriefNarratives narratives={doc.plan.narratives} />}
            {doc.plan.references && doc.plan.references.length > 0 && (
              <XBriefReferences references={doc.plan.references} />
            )}
            <XBriefReadinessPanel doc={doc} />
            <XBriefItemList items={doc.plan.items} />
          </>
        )}

        {tab === 'dag' && (
          <div className="flex-1 min-h-0" style={{ minHeight: 400 }} data-testid="xbrief-dag-pane">
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

/** Lazy-load the plan map so the DAG code stays out of the base bundle */
function DAGPlaceholder({ issueId }: { issueId: string }) {
  const [DAGViewer, setDAGViewer] = useState<React.ComponentType<{ issueId: string }> | null>(null);

  useEffect(() => {
    import('./PlanMapViewer.js').then(m => {
      setDAGViewer(() => m.PlanMapViewer);
    }).catch(() => {/* plan map unavailable */});
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

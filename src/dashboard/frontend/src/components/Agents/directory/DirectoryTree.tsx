/**
 * Left pane of the Agents Directory (PAN-3920 W6): locations, projects,
 * issues and each project's Conversations group, with live/total counts.
 * Focus stays on the tree container; the selected node is its
 * aria-activedescendant.
 */
import { forwardRef, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { ViewToggle } from '../../shared/ViewToggle';
import type { DirectoryNode } from './directory-tree';
import type { DirectoryWindowHours } from './useAgentDirectory';

const WINDOW_OPTIONS = [
  { id: '24', label: '24h' },
  { id: '168', label: '7d' },
] as const;

export function directoryNodeDomId(nodeId: string): string {
  return `directory-node-${nodeId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

interface DirectoryTreeProps {
  nodes: ReadonlyArray<{ node: DirectoryNode; depth: number }>;
  selectedNodeId: string | null;
  collapsed: ReadonlySet<string>;
  windowHours: DirectoryWindowHours;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onWindowChange: (windowHours: DirectoryWindowHours) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export const DirectoryTree = forwardRef<HTMLDivElement, DirectoryTreeProps>(function DirectoryTree(
  { nodes, selectedNodeId, collapsed, windowHours, onSelect, onToggle, onWindowChange, onKeyDown },
  ref,
) {
  return (
    <div className="flex min-h-0 flex-col border-r border-border" data-component="directory-tree-pane">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="text-[12px] font-medium text-foreground">Locations</span>
        <ViewToggle
          ariaLabel="Directory window"
          options={WINDOW_OPTIONS.map((option) => ({ ...option }))}
          value={String(windowHours) as '24' | '168'}
          onChange={(value) => onWindowChange(value === '168' ? 168 : 24)}
        />
      </div>
      <div
        ref={ref}
        role="tree"
        aria-label="Agent locations and projects"
        aria-activedescendant={selectedNodeId ? directoryNodeDomId(selectedNodeId) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {nodes.map(({ node, depth }) => {
          const selected = node.id === selectedNodeId;
          const expandable = node.children.length > 0;
          const expanded = expandable && !collapsed.has(node.id);
          return (
            <div
              key={node.id}
              id={directoryNodeDomId(node.id)}
              role="treeitem"
              aria-selected={selected}
              aria-level={depth + 1}
              aria-expanded={expandable ? expanded : undefined}
              data-component="directory-node"
              data-node-id={node.id}
              onClick={() => onSelect(node.id)}
              className={cn(
                'flex h-7 cursor-pointer items-center gap-1 pr-3 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground',
                selected && 'bg-accent text-foreground',
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {expandable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                  className="flex h-4 w-4 items-center justify-center text-muted-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(node.id);
                  }}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : (
                <span className="w-4" aria-hidden="true" />
              )}
              <span
                className="min-w-0 flex-1 truncate"
                title={node.title ? `${node.label} · ${node.title}` : node.label}
              >
                <span className={cn(node.kind === 'issue' && 'font-mono-ui text-[11px]')}>{node.label}</span>
                {node.title && <span className="text-muted-foreground"> · {node.title}</span>}
              </span>
              <span className="shrink-0 font-mono-ui text-[11px] tabular-nums text-muted-foreground">
                {node.liveCount}/{node.totalCount}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

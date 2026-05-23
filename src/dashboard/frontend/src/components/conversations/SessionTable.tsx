/**
 * Session list table (PAN-457)
 */

import { Anchor, CheckCircle, Circle, Star } from 'lucide-react';

interface Session {
  id: number;
  source: 'discovered' | 'managed-archived';
  workspacePath: string | null;
  jsonlPath: string | null;
  primaryModel: string | null;
  messageCount: number;
  lastTs: string | null;
  estimatedCost: number;
  tags: string[];
  summary: string | null;
  archivedAt?: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  panopticonManaged: boolean;
  panIssueId: string | null;
}

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function SessionTable({ sessions, selectedId, onSelect }: Props) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
            <th className="text-left px-3 py-2 font-medium w-8"></th>
            <th className="text-left px-3 py-2 font-medium">Workspace</th>
            <th className="text-left px-3 py-2 font-medium w-32">Model</th>
            <th className="text-right px-3 py-2 font-medium w-12">Msgs</th>
            <th className="text-right px-3 py-2 font-medium w-20">Cost</th>
            <th className="text-left px-3 py-2 font-medium w-32">Last Active</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const key = `${session.source}-${session.id}`;
            const isSelected = key === selectedId;
            const workspace = session.workspacePath ?? session.jsonlPath ?? 'Unknown session path';
            const shortWorkspace = workspace.split('/').slice(-2).join('/');

            return (
              <tr
                key={key}
                onClick={() => onSelect(isSelected ? null : key)}
                className={`border-b border-gray-900 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-950 border-blue-900'
                    : 'hover:bg-gray-900'
                }`}
              >
                {/* Enrichment/managed indicator */}
                <td className="px-3 py-1.5 text-center">
                  {session.source === 'managed-archived' ? (
                    <Anchor className="h-3 w-3 text-amber-400 inline" />
                  ) : session.panopticonManaged ? (
                    <Star className="h-3 w-3 text-cyan-400 inline" />
                  ) : session.enrichmentLevel > 0 ? (
                    <CheckCircle className="h-3 w-3 text-green-500 inline" />
                  ) : (
                    <Circle className="h-3 w-3 text-gray-700 inline" />
                  )}
                </td>

                {/* Workspace + summary */}
                <td className="px-3 py-1.5 max-w-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="font-mono text-gray-200 truncate" title={workspace}>
                      {shortWorkspace}
                    </div>
                    {session.source === 'managed-archived' ? (
                      <span className="shrink-0 rounded-full border border-amber-700 bg-amber-950 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                        Archived{session.panIssueId ? ` · ${session.panIssueId}` : ''}
                      </span>
                    ) : session.panopticonManaged && (
                      <span className="shrink-0 rounded-full border border-cyan-700 bg-cyan-950 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200">
                        Managed{session.panIssueId ? ` · ${session.panIssueId}` : ''}
                      </span>
                    )}
                  </div>
                  {session.summary && (
                    <div className="text-gray-500 truncate mt-0.5" title={session.summary}>
                      {session.summary}
                    </div>
                  )}
                  {session.tags.length > 0 && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {session.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="px-1 py-0 bg-gray-800 text-gray-400 rounded text-[10px]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                {/* Model */}
                <td className="px-3 py-1.5 text-gray-400 truncate max-w-[8rem]">
                  {session.primaryModel ? session.primaryModel.split('-').slice(-2).join('-') : '—'}
                </td>

                {/* Messages */}
                <td className="px-3 py-1.5 text-right text-gray-400 font-mono">
                  {session.messageCount}
                </td>

                {/* Cost */}
                <td className="px-3 py-1.5 text-right font-mono">
                  {session.estimatedCost > 0 ? (
                    <span className="text-yellow-500">${session.estimatedCost.toFixed(4)}</span>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
                </td>

                {/* Last active */}
                <td className="px-3 py-1.5 text-gray-500">
                  {session.lastTs ? formatRelative(session.lastTs) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/**
 * Session detail drawer (PAN-457)
 */

import { X, ExternalLink, Sparkles } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Session {
  id: number;
  jsonlPath: string;
  workspacePath: string | null;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  tags: string[];
  summary: string | null;
  summaryDetailed?: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  panopticonManaged: boolean;
  panIssueId: string | null;
}

interface Props {
  session: Session;
  onClose: () => void;
}

async function enrichSession(sessionId: number, tier: number): Promise<void> {
  const resp = await fetch(`/api/discovered-sessions/${sessionId}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  });
  if (!resp.ok) throw new Error('Enrichment failed');
}

async function fetchSession(sessionId: number): Promise<Session> {
  const resp = await fetch(`/api/discovered-sessions/${sessionId}`);
  if (!resp.ok) throw new Error('Failed to fetch session');
  return resp.json() as Promise<Session>;
}

export function SessionDetail({ session, onClose }: Props) {
  const queryClient = useQueryClient();

  const { data: freshSession } = useQuery({
    queryKey: ['discovered-session', session.id],
    queryFn: () => fetchSession(session.id),
    staleTime: Infinity,
    placeholderData: session,
  });
  const displaySession = freshSession ?? session;

  const enrichMutation = useMutation({
    mutationFn: (tier: number) => enrichSession(session.id, tier),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discovered-session', session.id] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-search'] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-stats'] });
    },
  });

  const field = (label: string, value: string | number | null | undefined) => (
    <div className="flex gap-2 text-xs py-1 border-b border-gray-900">
      <span className="text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-gray-200 font-mono break-all">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full border-l border-gray-800 bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Session #{displaySession.id}</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-4">
        {/* Summary */}
        {displaySession.summary && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Summary
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">{displaySession.summary}</p>
          </div>
        )}

        {displaySession.summaryDetailed && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Detailed
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{displaySession.summaryDetailed}</p>
          </div>
        )}

        {/* Tags */}
        {displaySession.tags.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {displaySession.tags.map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 bg-gray-800 text-cyan-400 rounded text-[10px]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Metadata
          </div>
          {field('Workspace', displaySession.workspacePath)}
          {field('Model', displaySession.primaryModel)}
          {field('Messages', displaySession.messageCount)}
          {field('Input tokens', displaySession.tokenInput.toLocaleString())}
          {field('Output tokens', displaySession.tokenOutput.toLocaleString())}
          {field('Est. cost', displaySession.estimatedCost > 0 ? `$${displaySession.estimatedCost.toFixed(6)}` : null)}
          {field('First active', displaySession.firstTs ? formatDate(displaySession.firstTs) : null)}
          {field('Last active', displaySession.lastTs ? formatDate(displaySession.lastTs) : null)}
          {displaySession.panIssueId && field('Issue', displaySession.panIssueId)}
          {field('Enrichment', displaySession.enrichmentLevel === 0 ? 'None' : `L${displaySession.enrichmentLevel}`)}
        </div>

        {/* Tools */}
        {displaySession.toolsUsed.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Tools Used
            </div>
            <div className="flex flex-wrap gap-1">
              {displaySession.toolsUsed.map((tool) => (
                <span key={tool} className="px-1.5 py-0.5 bg-gray-900 text-gray-400 rounded text-[10px] font-mono">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* JSONL path */}
        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            File
          </div>
          <div className="flex items-start gap-1">
            <ExternalLink className="h-3 w-3 text-gray-600 mt-0.5 shrink-0" />
            <span className="text-[10px] text-gray-600 font-mono break-all">{displaySession.jsonlPath}</span>
          </div>
        </div>
      </div>

      {/* Enrichment controls */}
      {displaySession.enrichmentLevel < 2 && (
        <div className="px-3 py-2 border-t border-gray-800 shrink-0">
          <div className="text-[10px] text-gray-500 mb-1.5">
            {displaySession.enrichmentFailed ? 'Enrichment failed — retry:' : 'Enrich this session'}
          </div>
          <div className="flex gap-2">
            {displaySession.enrichmentLevel < 1 && (
              <button
                onClick={() => enrichMutation.mutate(1)}
                disabled={enrichMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                Quick (L1)
              </button>
            )}
            <button
              onClick={() => enrichMutation.mutate(2)}
              disabled={enrichMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3 text-yellow-400" />
              Detailed (L2)
            </button>
          </div>
          {enrichMutation.isPending && (
            <div className="text-[10px] text-blue-400 mt-1">Enriching…</div>
          )}
          {enrichMutation.isError && (
            <div className="text-[10px] text-red-400 mt-1">Enrichment failed</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return iso;
  }
}

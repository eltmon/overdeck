/**
 * Session detail drawer (PAN-457)
 */

import { useState } from 'react';
import { X, ExternalLink, Sparkles } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WS_METHODS } from '@panctl/contracts';
import type { DiscoveredSessionSnapshot } from '@panctl/contracts';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { useDashboardStore } from '../../lib/store';

interface Session {
  id: number;
  source?: 'discovered' | 'managed-archived';
  conversationName?: string | null;
  archivedAt?: string | null;
  jsonlPath: string | null;
  workspacePath: string | null;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  filesTouched: string[];
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

interface EnrichRequest {
  tier: 1 | 2 | 3;
  confirmed?: boolean;
  model?: string;
}

interface CostThresholdDetails {
  tier: 1 | 2 | 3;
  estimatedCost: number;
  threshold: number;
  sessionCount: number;
  model?: string;
}

async function enrichSession(sessionId: number, request: EnrichRequest): Promise<void> {
  await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.enrichSessions]({
      ids: [sessionId],
      level: request.tier,
      confirmed: request.confirmed,
      ...(request.model ? { model: request.model } : {}),
    }),
  );
}

async function embedSession(sessionId: number): Promise<void> {
  await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.embedSessions]({
      ids: [sessionId],
    }),
  );
}

async function unarchiveConversation(conversationName: string | null | undefined): Promise<void> {
  if (!conversationName) throw new Error('Archived conversation is missing its name');
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationName)}/unarchive`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(`Unarchive failed: ${response.status}`);
}

function parseCostThreshold(err: unknown, request: EnrichRequest): CostThresholdDetails | null {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  const match = /^COST_THRESHOLD:([^:]+):([^:]+):([^:]+)$/.exec(code);
  if (!match) return null;
  return {
    tier: request.tier,
    estimatedCost: Number(match[1]),
    threshold: Number(match[2]),
    sessionCount: Number(match[3]),
    model: request.model,
  };
}

function fromRpcSession(session: DiscoveredSessionSnapshot): Session {
  return {
    id: session.id,
    jsonlPath: session.jsonlPath,
    workspacePath: session.workspacePath ?? null,
    primaryModel: session.primaryModel ?? null,
    messageCount: session.messageCount,
    firstTs: session.firstTs ?? null,
    lastTs: session.lastTs ?? null,
    estimatedCost: session.estimatedCost,
    tokenInput: session.tokenInput,
    tokenOutput: session.tokenOutput,
    toolsUsed: [...session.toolsUsed],
    filesTouched: [...session.filesTouched],
    tags: [...session.tags],
    summary: session.summary ?? null,
    summaryDetailed: session.summaryDetailed ?? null,
    enrichmentLevel: session.enrichmentLevel as 0 | 1 | 2 | 3,
    enrichmentFailed: session.enrichmentFailed,
    panopticonManaged: session.panopticonManaged,
    panIssueId: session.panIssueId ?? null,
  };
}

async function fetchSession(sessionId: number): Promise<Session> {
  const session = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getDiscoveredSession]({ id: sessionId }),
  );
  return fromRpcSession(session);
}

export function SessionDetail({ session, onClose }: Props) {
  const queryClient = useQueryClient();
  const [pendingCost, setPendingCost] = useState<CostThresholdDetails | null>(null);
  const [customModel, setCustomModel] = useState('');
  const isArchived = session.source === 'managed-archived';
  const enrichProgress = useDashboardStore((s) => s.enrichProgressBySessionId[session.id]);

  const { data: freshSession } = useQuery({
    queryKey: ['discovered-session', session.id],
    queryFn: () => fetchSession(session.id),
    staleTime: Infinity,
    placeholderData: session,
    enabled: !isArchived,
  });
  const displaySession = isArchived ? session : freshSession ?? session;

  const invalidateSessionQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['discovered-session', session.id] });
    void queryClient.invalidateQueries({ queryKey: ['discovered-sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-search'] });
    void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-stats'] });
  };

  const enrichMutation = useMutation({
    mutationFn: (request: EnrichRequest) => enrichSession(session.id, request),
    onSuccess: () => {
      setPendingCost(null);
      invalidateSessionQueries();
    },
    onError: (err, request) => {
      setPendingCost(parseCostThreshold(err, request));
    },
  });

  const embedMutation = useMutation({
    mutationFn: () => embedSession(session.id),
    onSuccess: invalidateSessionQueries,
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => unarchiveConversation(displaySession.conversationName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['archived-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const field = (label: string, value: string | number | null | undefined) => (
    <div className="flex gap-2 text-xs py-1 border-b border-gray-900">
      <span className="text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-gray-200 font-mono break-all">{value ?? '—'}</span>
    </div>
  );
  const enrichWithTier = (tier: 1 | 2 | 3) => {
    const model = customModel.trim();
    enrichMutation.mutate({ tier, ...(model ? { model } : {}) });
  };

  return (
    <div className="flex flex-col h-full border-l border-gray-800 bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300">Session #{displaySession.id}</span>
          <span
            className={displaySession.panopticonManaged
              ? 'rounded border border-emerald-500/40 bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300'
              : 'rounded border border-amber-500/40 bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300'}
            title={displaySession.panopticonManaged ? 'Panopticon-managed session' : 'Ad-hoc discovered session'}
          >
            {displaySession.panopticonManaged ? `Managed${displaySession.panIssueId ? ` · ${displaySession.panIssueId}` : ''}` : 'Ad-hoc'}
          </span>
        </div>
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
          {isArchived && field('Archived at', displaySession.archivedAt ? formatDate(displaySession.archivedAt) : null)}
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

        {/* Files touched */}
        {displaySession.filesTouched.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Files Touched
            </div>
            <div className="space-y-1 max-h-28 overflow-auto">
              {displaySession.filesTouched.map((file) => (
                <div key={file} className="text-[10px] text-gray-500 font-mono break-all">
                  {file}
                </div>
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
            <span className="text-[10px] text-gray-600 font-mono break-all">{displaySession.jsonlPath ?? 'No JSONL path available'}</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-gray-800 shrink-0">
        {isArchived ? (
          <div>
            <div className="text-[10px] text-gray-500 mb-1.5">Archived conversation</div>
            <div className="text-[10px] text-gray-600 mb-2">
              Restore this conversation to the active Command Deck list.
            </div>
            <button
              onClick={() => unarchiveMutation.mutate()}
              disabled={unarchiveMutation.isPending || unarchiveMutation.isSuccess}
              className="rounded bg-amber-700 px-2 py-1 text-xs text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              {unarchiveMutation.isPending ? 'Unarchiving…' : 'Unarchive'}
            </button>
            {unarchiveMutation.isSuccess && (
              <div className="text-[10px] text-green-400 mt-1">Conversation restored</div>
            )}
            {unarchiveMutation.isError && (
              <div className="text-[10px] text-red-400 mt-1">
                {unarchiveMutation.error instanceof Error ? unarchiveMutation.error.message : 'Unarchive failed'}
              </div>
            )}
          </div>
        ) : (
          <>
            {displaySession.enrichmentLevel < 3 && (
              <>
                <div className="text-[10px] text-gray-500 mb-1.5">
                  {displaySession.enrichmentFailed ? 'Enrichment failed — retry:' : 'Enrich this session'}
                </div>
                <div className="text-[10px] text-amber-500/80 mb-1.5">
                  Sends redacted conversation excerpts to the configured enrichment provider.
                </div>
                <label className="mb-2 block text-[10px] text-gray-500">
                  Custom model
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="Use default provider model"
                    className="mt-1 w-full rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {displaySession.enrichmentLevel < 1 && (
                    <button
                      onClick={() => enrichWithTier(1)}
                      disabled={enrichMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" />
                      Quick (L1)
                    </button>
                  )}
                  {displaySession.enrichmentLevel < 2 && (
                    <button
                      onClick={() => enrichWithTier(2)}
                      disabled={enrichMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3 text-yellow-400" />
                      Detailed (L2)
                    </button>
                  )}
                  <button
                    onClick={() => enrichWithTier(3)}
                    disabled={enrichMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3 text-purple-400" />
                    Deep (L3)
                  </button>
                </div>
              </>
            )}
            {enrichMutation.isPending && (
              <div className="text-[10px] text-blue-400 mt-1">Enriching…</div>
            )}
            {enrichProgress && (
              <div className={enrichProgress.success ? 'text-[10px] text-green-400 mt-1' : 'text-[10px] text-red-400 mt-1'}>
                L{enrichProgress.level} {enrichProgress.success ? 'complete' : `failed: ${enrichProgress.error ?? 'unknown error'}`} · {enrichProgress.model}
              </div>
            )}
            {pendingCost && (
              <div className="mt-2 rounded border border-amber-700/60 bg-amber-950/30 p-2 text-[10px] text-amber-200">
                Estimated cost ${pendingCost.estimatedCost.toFixed(4)} exceeds threshold ${pendingCost.threshold.toFixed(2)} for {pendingCost.sessionCount} session{pendingCost.sessionCount === 1 ? '' : 's'}.
                <button
                  onClick={() => enrichMutation.mutate({ tier: pendingCost.tier, confirmed: true, model: pendingCost.model })}
                  disabled={enrichMutation.isPending}
                  className="ml-2 rounded bg-amber-700 px-1.5 py-0.5 text-amber-50 disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            )}
            {enrichMutation.isError && !pendingCost && (
              <div className="text-[10px] text-red-400 mt-1">Enrichment failed</div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-gray-900 pt-2">
              <div>
                <div className="text-[10px] text-gray-500">Semantic embedding</div>
                <div className="text-[10px] text-gray-600">Generate or refresh this session's vector index.</div>
              </div>
              <button
                onClick={() => embedMutation.mutate()}
                disabled={embedMutation.isPending}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
              >
                Embed
              </button>
            </div>
            {embedMutation.isPending && <div className="text-[10px] text-blue-400 mt-1">Embedding…</div>}
            {embedMutation.isSuccess && <div className="text-[10px] text-green-400 mt-1">Embedding complete</div>}
            {embedMutation.isError && <div className="text-[10px] text-red-400 mt-1">Embedding failed</div>}
          </>
        )}
      </div>
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

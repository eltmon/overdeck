import { AlertTriangle, CheckCircle, Loader2, RefreshCw, Zap } from 'lucide-react';
import { ReindexConfirmDialog } from '../ReindexConfirmDialog';
import type {
  ConversationSearchCostEstimate,
  ConversationSearchStatusResponse,
  ConvConfig,
  ReindexConfirmState,
  ReindexProgress,
} from '../hooks/useConversationSearch';
import type { ConversationSearchConfig } from '../types';
import { EMBEDDING_MODELS_BY_PROVIDER } from '../embeddingModels';

interface ConversationSearchSectionProps {
  conversationSearch: ConversationSearchConfig;
  conversationSearchEnabled: boolean;
  conversationSearchEstimate: ConversationSearchCostEstimate | null;
  conversationSearchModel: string;
  conversationSearchReindexPending: boolean;
  conversationSearchStatus: ConversationSearchStatusResponse | undefined;
  convConfig: ConvConfig | null;
  convConfigDirty: boolean;
  convConfigError: string | null;
  convConfigLoading: boolean;
  convConfigSaving: boolean;
  embeddingTestResult: { ok: boolean; latencyMs?: number; error?: string } | null;
  estimatingConversationSearch: boolean;
  hasOpenAiKey: boolean;
  loadConvConfig: () => void;
  reindexConfirm: ReindexConfirmState | null;
  reindexConfirmBusy: boolean;
  reindexProgress: ReindexProgress | null;
  testingEmbedding: boolean;
  onCancelReindexConfirm: () => void;
  onConfirmReindex: () => Promise<void>;
  onConversationSearchChange: (patch: Partial<ConversationSearchConfig>) => void;
  onConversationSearchReindex: () => void;
  onConvConfigChange: (patch: Partial<ConvConfig>) => void;
  onEmbeddingModelChange: (newModel: string) => void;
  onSaveConvConfig: () => Promise<void>;
  onTestEmbeddingConnection: () => Promise<void>;
}

export function ConversationSearchSection({
  conversationSearch,
  conversationSearchEnabled,
  conversationSearchEstimate,
  conversationSearchModel,
  conversationSearchReindexPending,
  conversationSearchStatus,
  convConfig,
  convConfigDirty,
  convConfigError,
  convConfigLoading,
  convConfigSaving,
  embeddingTestResult,
  estimatingConversationSearch,
  hasOpenAiKey,
  loadConvConfig,
  reindexConfirm,
  reindexConfirmBusy,
  reindexProgress,
  testingEmbedding,
  onCancelReindexConfirm,
  onConfirmReindex,
  onConversationSearchChange,
  onConversationSearchReindex,
  onConvConfigChange,
  onEmbeddingModelChange,
  onSaveConvConfig,
  onTestEmbeddingConnection,
}: ConversationSearchSectionProps) {
  return (
    <>
      <div className="border-t border-border my-2" />

      <div className="px-4 py-3 rounded-lg bg-muted/15 border border-border/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Conversation Search</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Index Claude JSONL transcripts for Ctrl+K semantic search. Disabled by default; enabling sends transcript chunks to the configured embedding provider.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={conversationSearchEnabled}
            aria-label="Toggle conversation search"
            onClick={() => onConversationSearchChange({ enabled: !conversationSearchEnabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              conversationSearchEnabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              conversationSearchEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-muted-foreground">
            Provider
            <select
              value={conversationSearch.provider ?? 'openai'}
              onChange={(e) => onConversationSearchChange({ provider: e.target.value as 'openai' })}
              className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Model
            <select
              value={conversationSearchModel}
              onChange={(e) => onEmbeddingModelChange(e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              {(EMBEDDING_MODELS_BY_PROVIDER[conversationSearch.provider ?? 'openai'] ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.description}</option>
              ))}
            </select>
            {(() => {
              const desc = (EMBEDDING_MODELS_BY_PROVIDER[conversationSearch.provider ?? 'openai'] ?? [])
                .find((m) => m.id === conversationSearchModel)?.description;
              return desc ? <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">{desc}</span> : null;
            })()}
          </label>
          <div className="flex items-end text-xs">
            {hasOpenAiKey ? (
              <span className="text-success">✓ Using OpenAI key from API Keys section</span>
            ) : (
              <span className="text-warning">No OpenAI key set — configure in API Keys above</span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>
            <span>Last indexed: </span>
            <span className="text-foreground">
              {conversationSearchStatus?.lastIndexedAt
                ? conversationSearchStatus.lastIndexedAt.slice(0, 19).replace('T', ' ')
                : 'Never'}
            </span>
            {conversationSearchStatus && (
              <span className="ml-2">
                ({conversationSearchStatus.chunkCount} chunks · {conversationSearchStatus.indexedFileCount} files)
              </span>
            )}
            {conversationSearchStatus && !conversationSearchStatus.available && (
              <span className="ml-2 text-destructive">{conversationSearchStatus.unavailableReason}</span>
            )}
            {conversationSearchEstimate && !conversationSearchEstimate.disabled && (
              <span className="block mt-1">
                Estimated reindex cost: <span className="text-foreground">${conversationSearchEstimate.estimatedUsd.toFixed(4)}</span>
                {' '}({conversationSearchEstimate.tokenCount.toLocaleString()} tokens · {conversationSearchEstimate.chunksEstimated} chunks)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void onConversationSearchReindex()}
            disabled={!conversationSearchEnabled || estimatingConversationSearch || conversationSearchReindexPending}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/30 text-foreground transition-colors disabled:opacity-50"
          >
            {estimatingConversationSearch || conversationSearchReindexPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Estimate & reindex all conversations
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">
          <span className="text-foreground">Estimate &amp; reindex</span> rebuilds the entire semantic-search index from your conversation transcripts: it shows the one-time embedding-API cost, asks you to confirm, then re-embeds every conversation. Run it after switching the model, or to pick up transcripts created before search was enabled.
        </p>

        {conversationSearchReindexPending && reindexProgress && (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1">
              <span className="truncate">
                {reindexProgress.currentFile ? `Indexing ${reindexProgress.currentFile}…` : 'Finishing up…'}
              </span>
              <span className="text-foreground tabular-nums shrink-0">
                {reindexProgress.filesIndexed}/{reindexProgress.filesScanned || '—'} files · {reindexProgress.chunksIndexed.toLocaleString()} chunks
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${reindexProgress.filesScanned > 0 ? Math.min(100, Math.round((reindexProgress.filesIndexed / reindexProgress.filesScanned) * 100)) : 5}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border my-2" />

      {convConfigLoading ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading embedding settings…
        </div>
      ) : convConfigError ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="text-muted-foreground">{convConfigError}</span>
          <button
            type="button"
            onClick={loadConvConfig}
            className="ml-1 inline-flex items-center gap-1 text-foreground hover:underline"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      ) : convConfig ? (
        <>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Semantic embeddings</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Store vector embeddings for semantic conversation search. Non-local providers receive session-derived summaries, tags, workspace paths, and tool names.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={convConfig.embeddings}
              aria-label="Toggle semantic embeddings"
              onClick={() => onConvConfigChange({ embeddings: !convConfig.embeddings })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                convConfig.embeddings ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                convConfig.embeddings ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>

          {convConfig.embeddings && (
            <>
              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">Embedding provider</span>
                  <p className="text-xs text-muted-foreground mt-0.5">Which API generates embeddings</p>
                </div>
                <select
                  value={convConfig.embeddingProvider}
                  onChange={(e) => {
                    const provider = e.target.value;
                    const defaultModel = provider === 'openai'
                      ? 'text-embedding-3-small'
                      : provider === 'voyage'
                        ? 'voyage-code-3'
                        : 'nomic-embed-text';
                    onConvConfigChange({ embeddingProvider: provider, embeddingModel: defaultModel });
                  }}
                  className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  <option value="openai">OpenAI</option>
                  <option value="voyage">Voyage AI</option>
                  <option value="ollama">Ollama (local)</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">Embedding model</span>
                  <p className="text-xs text-muted-foreground mt-0.5">Model name for the selected provider</p>
                </div>
                <input
                  type="text"
                  value={convConfig.embeddingModel}
                  onChange={(e) => onConvConfigChange({ embeddingModel: e.target.value })}
                  className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary w-[220px]"
                  placeholder="text-embedding-3-small"
                />
              </div>

              {convConfig.embeddingProvider !== 'ollama' && (
                <div className="px-4 py-3 rounded-lg bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    API key is read from{' '}
                    <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">
                      {convConfig.embeddingProvider === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY'}
                    </code>{' '}
                    or <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">~/.overdeck.env</code>.
                    Session-derived summaries, tags, workspace paths, and tool names are sent to this provider.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">Auto-embed after deep enrichment</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generate embeddings when a session is enriched at tier 2 or 3
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={convConfig.embeddingAutoOnDeep}
                  aria-label="Toggle auto-embed after deep enrichment"
                  onClick={() => onConvConfigChange({ embeddingAutoOnDeep: !convConfig.embeddingAutoOnDeep })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    convConfig.embeddingAutoOnDeep ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    convConfig.embeddingAutoOnDeep ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onTestEmbeddingConnection}
                    disabled={testingEmbedding}
                    className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/30 text-foreground transition-colors disabled:opacity-50"
                  >
                    {testingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Test connection
                  </button>
                  {embeddingTestResult && (
                    <span className={`text-xs flex items-center gap-1 ${embeddingTestResult.ok ? 'text-success' : 'text-destructive'}`}>
                      {embeddingTestResult.ok
                        ? <><CheckCircle className="w-3.5 h-3.5" /> Connected ({embeddingTestResult.latencyMs}ms)</>
                        : <><AlertTriangle className="w-3.5 h-3.5" /> {embeddingTestResult.error}</>}
                    </span>
                  )}
                </div>
                {convConfigDirty && (
                  <button
                    type="button"
                    onClick={() => void onSaveConvConfig()}
                    disabled={convConfigSaving}
                    className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {convConfigSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Save embeddings
                  </button>
                )}
              </div>
            </>
          )}
        </>
      ) : null}

      <ReindexConfirmDialog
        open={reindexConfirm !== null}
        title={reindexConfirm?.kind === 'model' ? 'Switch embedding model?' : 'Reindex all conversations?'}
        intro={reindexConfirm?.kind === 'model' ? (
          <>
            Switching to <span className="text-foreground font-medium">{reindexConfirm?.newModel}</span> invalidates
            every cached embedding — vectors can&apos;t be reused across models — and runs a full reindex with the new
            model. This is a one-time embedding-API cost:
          </>
        ) : (
          <>This re-embeds every conversation transcript from scratch and replaces the existing index, calling the OpenAI embeddings API once for your whole history:</>
        )}
        estimate={reindexConfirm?.estimate ?? null}
        estimating={estimatingConversationSearch && !reindexConfirm?.estimate}
        confirmLabel={reindexConfirm?.kind === 'model' ? 'Switch & reindex' : 'Reindex now'}
        busy={reindexConfirmBusy}
        onConfirm={() => void onConfirmReindex()}
        onCancel={onCancelReindexConfirm}
      />
    </>
  );
}

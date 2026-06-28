import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConversationSearchConfig, SettingsConfig, VoiceSettings } from '../types';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

interface ConversationSearchStatusResponse {
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
  dbPath: string;
  chunkCount: number;
  indexedFileCount: number;
  lastIndexedAt: string | null;
}

async function fetchConversationSearchStatus(): Promise<ConversationSearchStatusResponse> {
  const res = await fetch('/api/settings/conversation-search/status', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch conversation search status');
  return res.json();
}

export interface ConversationSearchCostEstimate {
  provider: 'openai';
  model: string;
  tokenCount: number;
  pricePerMillionTokens: number;
  estimatedUsd: number;
  filesScanned: number;
  chunksEstimated: number;
  disabled: boolean;
  unavailableReason?: string;
  confirmationNonce?: string;
}

async function estimateConversationSearchReindex(model?: string): Promise<ConversationSearchCostEstimate> {
  // Pass ?model= to price a prospective model switch before it's saved.
  const qs = model ? `?model=${encodeURIComponent(model)}` : '';
  const res = await fetch(`/api/settings/conversation-search/reindex-estimate${qs}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to estimate reindex cost (${res.status})`);
  }
  return res.json();
}

async function reindexConversationSearch(confirmationNonce?: string): Promise<{ filesScanned: number; chunksIndexed: number; disabled: boolean; unavailableReason?: string }> {
  const res = await fetch('/api/settings/conversation-search/reindex', {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ confirmationNonce }),
  });
  if (!res.ok) throw new Error('Failed to reindex conversations');
  return res.json();
}

interface ConvConfig {
  embeddings: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingAutoOnDeep: boolean;
}

interface ReindexConfirmState {
  kind: 'manual' | 'model';
  newModel?: string;
  estimate: ConversationSearchCostEstimate | null;
}

interface ReindexProgress {
  active: boolean;
  filesScanned: number;
  filesIndexed: number;
  chunksIndexed: number;
  currentFile?: string;
}

interface UseConversationSearchArgs {
  formData: SettingsConfig | null;
  voiceFormData: VoiceSettings | null;
  setFormData: Dispatch<SetStateAction<SettingsConfig | null>>;
  scheduleAutosave: (payload: { settings: SettingsConfig; voiceSettings: VoiceSettings }, opts?: { debounce?: boolean }) => void;
  flushAutosave: () => Promise<boolean>;
}

export function useConversationSearch({
  formData,
  voiceFormData,
  setFormData,
  scheduleAutosave,
  flushAutosave,
}: UseConversationSearchArgs) {
  const queryClient = useQueryClient();
  const { data: conversationSearchStatus } = useQuery({
    queryKey: ['conversation-search-status'],
    queryFn: fetchConversationSearchStatus,
    refetchInterval: 30_000,
  });
  const [convConfig, setConvConfig] = useState<ConvConfig | null>(null);
  const [convConfigDirty, setConvConfigDirty] = useState(false);
  const [convConfigSaving, setConvConfigSaving] = useState(false);
  const [convConfigLoading, setConvConfigLoading] = useState(true);
  const [convConfigError, setConvConfigError] = useState<string | null>(null);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [conversationSearchEstimate, setConversationSearchEstimate] = useState<ConversationSearchCostEstimate | null>(null);
  const [estimatingConversationSearch, setEstimatingConversationSearch] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [reindexConfirm, setReindexConfirm] = useState<ReindexConfirmState | null>(null);
  const [reindexConfirmBusy, setReindexConfirmBusy] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<ReindexProgress | null>(null);

  const conversationSearch = formData?.conversationSearch ?? {};
  const conversationSearchEnabled = conversationSearch.enabled ?? false;
  const conversationSearchModel = conversationSearch.model ?? 'text-embedding-3-small';

  const loadConvConfig = useCallback(() => {
    setConvConfigLoading(true);
    setConvConfigError(null);
    ensureDashboardSession()
      .then(() => fetch('/api/discovered-sessions/config', { credentials: 'include' }))
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load embedding settings (HTTP ${r.status})`);
        return r.json();
      })
      .then((d) => setConvConfig(d))
      .catch((e) => setConvConfigError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConvConfigLoading(false));
  }, []);

  useEffect(() => { loadConvConfig(); }, [loadConvConfig]);

  const handleConvConfigChange = (patch: Partial<ConvConfig>) => {
    setConvConfig((prev) => prev ? { ...prev, ...patch } : null);
    setConvConfigDirty(true);
    setEmbeddingTestResult(null);
  };

  const handleSaveConvConfig = async () => {
    if (!convConfig) return;
    setConvConfigSaving(true);
    try {
      await ensureDashboardSession();
      const res = await fetch('/api/discovered-sessions/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(convConfig),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setFormData((prev) => prev ? {
        ...prev,
        conversations: {
          ...prev.conversations,
          embeddings: convConfig.embeddings,
          embedding_provider: convConfig.embeddingProvider as 'openai' | 'voyage' | 'ollama',
          embedding_model: convConfig.embeddingModel,
          embedding_auto_on_deep: convConfig.embeddingAutoOnDeep,
        },
      } : prev);
      setConvConfigDirty(false);
      toast.success('Embedding settings saved');
    } catch (err) {
      toast.error(`Failed to save embedding settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConvConfigSaving(false);
    }
  };

  const handleTestEmbeddingConnection = async () => {
    if (!convConfig) return;
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      await ensureDashboardSession();
      const res = await fetch('/api/discovered-sessions/test-connection', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: convConfig.embeddingProvider,
          model: convConfig.embeddingModel,
        }),
      });
      const result = await res.json();
      setEmbeddingTestResult(result);
    } catch (err) {
      setEmbeddingTestResult({ ok: false, error: String(err) });
    } finally {
      setTestingEmbedding(false);
    }
  };

  const conversationSearchReindexMutation = useMutation({
    mutationFn: reindexConversationSearch,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-search-status'] });
      if (result.disabled) {
        toast.warning(result.unavailableReason ?? 'Conversation search is disabled');
      } else {
        toast.success(`Reindexed ${result.chunksIndexed} chunk${result.chunksIndexed === 1 ? '' : 's'} from ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to reindex conversations: ${error.message}`);
    },
  });

  // Poll live reindex progress while a reindex is running so the UI can show a real bar.
  const conversationSearchReindexPending = conversationSearchReindexMutation.isPending;
  useEffect(() => {
    if (!conversationSearchReindexPending) {
      setReindexProgress(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/settings/conversation-search/reindex-progress', { credentials: 'include' });
        if (res.ok && !cancelled) setReindexProgress(await res.json());
      } catch { /* ignore transient poll errors */ }
    };
    void poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [conversationSearchReindexPending]);

  // Open the confirm modal immediately, then fill in the cost estimate (scanning every
  // transcript can take a few seconds). `model` prices a prospective switch.
  const openReindexConfirm = async (kind: 'manual' | 'model', newModel?: string) => {
    setReindexConfirm({ kind, newModel, estimate: null });
    setEstimatingConversationSearch(true);
    try {
      const estimate = await estimateConversationSearchReindex(newModel);
      setConversationSearchEstimate(estimate);
      setReindexConfirm((prev) => (prev && prev.kind === kind && prev.newModel === newModel ? { ...prev, estimate } : prev));
    } catch (error) {
      toast.error(`Failed to estimate reindex cost: ${error instanceof Error ? error.message : String(error)}`);
      setReindexConfirm(null);
    } finally {
      setEstimatingConversationSearch(false);
    }
  };

  const handleConversationSearchReindex = () => { void openReindexConfirm('manual'); };

  const handleConversationSearchChange = (patch: Partial<ConversationSearchConfig>) => {
    if (!formData || !voiceFormData) return;
    const next: SettingsConfig = {
      ...formData,
      conversationSearch: {
        ...(formData.conversationSearch ?? {}),
        ...patch,
      },
    };
    setFormData(next);
    scheduleAutosave({ settings: next, voiceSettings: voiceFormData });
  };

  // Switching the embedding model invalidates every cached vector (they're model-specific)
  // and forces a paid full reindex, so confirm before applying.
  const handleEmbeddingModelChange = (newModel: string) => {
    if (newModel === conversationSearchModel) return;
    void openReindexConfirm('model', newModel);
  };

  const cancelReindexConfirm = () => { if (!reindexConfirmBusy) setReindexConfirm(null); };

  const confirmReindex = async () => {
    if (!reindexConfirm || !reindexConfirm.estimate || reindexConfirm.estimate.disabled) return;
    const { kind, newModel, estimate } = reindexConfirm;
    if (kind === 'model' && newModel) {
      if (!formData || !voiceFormData) return;
      setReindexConfirmBusy(true);
      const next: SettingsConfig = {
        ...formData,
        conversationSearch: { ...(formData.conversationSearch ?? {}), model: newModel },
      };
      setFormData(next);
      scheduleAutosave({ settings: next, voiceSettings: voiceFormData });
      const saved = await flushAutosave();
      if (!saved) {
        // The autosave pipeline surfaces its own error toast; leave the modal open to retry.
        setReindexConfirmBusy(false);
        return;
      }
      conversationSearchReindexMutation.mutate(estimate.confirmationNonce);
      setReindexConfirmBusy(false);
      setReindexConfirm(null);
      return;
    }
    conversationSearchReindexMutation.mutate(estimate.confirmationNonce);
    setReindexConfirm(null);
  };

  return {
    cancelReindexConfirm,
    confirmReindex,
    conversationSearch,
    conversationSearchEnabled,
    conversationSearchEstimate,
    conversationSearchModel,
    conversationSearchReindexMutation,
    conversationSearchStatus,
    convConfig,
    convConfigDirty,
    convConfigError,
    convConfigLoading,
    convConfigSaving,
    embeddingTestResult,
    estimatingConversationSearch,
    handleConvConfigChange,
    handleConversationSearchChange,
    handleConversationSearchReindex,
    handleEmbeddingModelChange,
    handleSaveConvConfig,
    handleTestEmbeddingConnection,
    legacyImportOpen,
    loadConvConfig,
    reindexConfirm,
    reindexConfirmBusy,
    reindexProgress,
    setLegacyImportOpen,
    testingEmbedding,
  };
}

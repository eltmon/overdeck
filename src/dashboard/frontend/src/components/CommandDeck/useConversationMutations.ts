import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Conversation } from './ConversationList';
import { updateConversationTitle } from './ConversationList';

async function archiveConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/archive`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to archive conversation');
}

async function stopConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop conversation');
}

async function retitleConversation(name: string): Promise<{ title: string }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/retitle`, { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to regenerate title');
  return data as { title: string };
}

async function favoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to favorite conversation');
}

async function unfavoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unfavorite conversation');
}

type ApiForkMode = 'summary' | 'plain' | 'handoff';
type ForkModeOption = ApiForkMode | 'fast-summary';

async function summaryForkConversation(opts: { conv: Conversation; model: string; summaryModel: string; harness?: 'claude-code' | 'pi'; summaryHarness?: 'claude-code' | 'pi'; forkMode?: ApiForkMode; focus?: string; localSummaryOnly?: boolean; includeThinkingInSummary?: boolean; title?: string; cwd?: string }): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(opts.conv.name)}/summary-fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      summaryModel: opts.summaryModel,
      harness: opts.harness,
      summaryHarness: opts.summaryHarness,
      forkMode: opts.forkMode,
      plain: opts.forkMode === 'plain',
      focus: opts.focus,
      localSummaryOnly: opts.localSummaryOnly,
      includeThinkingInSummary: opts.includeThinkingInSummary,
      title: opts.title,
      // PAN-1533: when forking into a worktree, the cwd parameter (already
      // honored by the summary-fork endpoint) routes the new Claude session
      // to that path.
      cwd: opts.cwd,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to create summary fork');
  }
}

export interface ConversationMutations {
  archive: (name: string) => void;
  stop: (name: string) => void;
  rename: (opts: { name: string; title: string }) => void;
  retitle: (name: string) => void;
  isRetitlePending: (name: string) => boolean;
  toggleFavorite: (opts: { name: string; favorited: boolean }) => void;
  openForkModal: (conv: Conversation, options?: { mode?: ForkModeOption; targetCwd?: string; targetCwdLabel?: string }) => void;
  submitFork: (conv: Conversation, launchModel: string, summaryModel: string, forkMode: ApiForkMode, localSummaryOnly: boolean, includeThinkingInSummary: boolean, title?: string, launchHarness?: 'claude-code' | 'pi', summaryHarness?: 'claude-code' | 'pi', focus?: string, targetCwd?: string) => void;
  forkTarget: Conversation | null;
  forkTargetMode: ForkModeOption | undefined;
  forkTargetCwd: string | undefined;
  forkTargetCwdLabel: string | undefined;
  closeForkModal: () => void;
  isForkPending: boolean;
}

export function useConversationMutations(
  selectedConversation: string | null,
  onSelectConversation: (name: string | null) => void,
): ConversationMutations {
  const queryClient = useQueryClient();
  const [forkTarget, setForkTarget] = useState<Conversation | null>(null);
  const [forkTargetMode, setForkTargetMode] = useState<ForkModeOption | undefined>(undefined);
  // PAN-1533: pre-selected cwd for the fork (e.g. a conv worktree picked
  // from the branch chip's WorktreePickerMenu).
  const [forkTargetCwd, setForkTargetCwd] = useState<string | undefined>(undefined);
  const [forkTargetCwdLabel, setForkTargetCwdLabel] = useState<string | undefined>(undefined);
  const pendingFavoriteNamesRef = useRef(new Set<string>());

  const archiveMutation = useMutation({
    mutationFn: archiveConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ name, title }: { name: string; title: string }) => updateConversationTitle(name, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const pendingRetitleNamesRef = useRef(new Set<string>());
  const [retitleVersion, setRetitleVersion] = useState(0);
  const retitleMutation = useMutation({
    mutationFn: retitleConversation,
    onMutate: (name: string) => {
      pendingRetitleNamesRef.current.add(name);
      setRetitleVersion(v => v + 1);
    },
    onSuccess: (data, _name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(`Renamed to "${data.title}"`, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
    onSettled: (_data, _error, name) => {
      pendingRetitleNamesRef.current.delete(name);
      setRetitleVersion(v => v + 1);
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ name, favorited }: { name: string; favorited: boolean }) =>
      favorited ? unfavoriteConversation(name) : favoriteConversation(name),
    onMutate: async ({ name, favorited }) => {
      pendingFavoriteNamesRef.current.add(name);
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === name ? { ...c, isFavorited: !favorited } : c)) ?? [],
      );
      return { name, previousFavorited: favorited };
    },
    onError: (_err, vars, ctx) => {
      const name = ctx?.name ?? vars.name;
      const previousFavorited = ctx?.previousFavorited ?? vars.favorited;
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === name ? { ...c, isFavorited: previousFavorited } : c)) ?? [],
      );
    },
    onSettled: (_data, _error, vars) => {
      pendingFavoriteNamesRef.current.delete(vars.name);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const summaryForkMutation = useMutation({
    mutationFn: summaryForkConversation,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const msg = variables.forkMode === 'plain'
        ? 'Plain fork started — copying conversation history...'
        : variables.forkMode === 'handoff'
          ? 'Handoff fork started — requesting agent-authored context...'
          : 'Fork started — summarizing conversation...';
      toast.success(msg, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
      console.error('Summary fork failed:', err);
    },
  });

  const openForkModal = useCallback((conv: Conversation, options?: { mode?: ForkModeOption; targetCwd?: string; targetCwdLabel?: string }) => {
    if (!summaryForkMutation.isPending) {
      setForkTarget(conv);
      setForkTargetMode(options?.mode);
      setForkTargetCwd(options?.targetCwd);
      setForkTargetCwdLabel(options?.targetCwdLabel);
    }
  }, [summaryForkMutation.isPending]);

  const submitFork = useCallback((conv: Conversation, launchModel: string, summaryModel: string, forkMode: ApiForkMode, localSummaryOnly: boolean, includeThinkingInSummary: boolean, title?: string, launchHarness?: 'claude-code' | 'pi', summaryHarness?: 'claude-code' | 'pi', focus?: string, targetCwd?: string) => {
    summaryForkMutation.mutate({
      conv,
      model: launchModel,
      summaryModel,
      harness: launchHarness,
      summaryHarness,
      forkMode,
      focus,
      localSummaryOnly,
      includeThinkingInSummary,
      title,
      cwd: targetCwd,
    });
    setForkTarget(null);
    setForkTargetMode(undefined);
    setForkTargetCwd(undefined);
    setForkTargetCwdLabel(undefined);
  }, [summaryForkMutation]);

  // retitleVersion is referenced so isRetitlePending re-evaluates after pending changes.
  void retitleVersion;

  return {
    archive: (name) => archiveMutation.mutate(name),
    stop: (name) => { if (!stopMutation.isPending) stopMutation.mutate(name); },
    rename: (opts) => renameMutation.mutate(opts),
    retitle: (name) => {
      if (pendingRetitleNamesRef.current.has(name)) return;
      retitleMutation.mutate(name);
    },
    isRetitlePending: (name) => pendingRetitleNamesRef.current.has(name),
    toggleFavorite: (opts) => {
      if (pendingFavoriteNamesRef.current.has(opts.name)) return;
      favoriteMutation.mutate(opts);
    },
    openForkModal,
    submitFork,
    forkTarget,
    forkTargetMode,
    forkTargetCwd,
    forkTargetCwdLabel,
    closeForkModal: () => {
      setForkTarget(null);
      setForkTargetMode(undefined);
      setForkTargetCwd(undefined);
      setForkTargetCwdLabel(undefined);
    },
    isForkPending: summaryForkMutation.isPending,
  };
}

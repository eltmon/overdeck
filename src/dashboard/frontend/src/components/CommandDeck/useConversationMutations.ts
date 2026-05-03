import { useState, useCallback } from 'react';
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

async function favoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to favorite conversation');
}

async function unfavoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unfavorite conversation');
}

async function summaryForkConversation(opts: { conv: Conversation; model: string; summaryModel: string; plain?: boolean; localSummaryOnly?: boolean; includeThinkingInSummary?: boolean }): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(opts.conv.name)}/summary-fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      summaryModel: opts.summaryModel,
      plain: opts.plain,
      localSummaryOnly: opts.localSummaryOnly,
      includeThinkingInSummary: opts.includeThinkingInSummary,
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
  toggleFavorite: (opts: { name: string; favorited: boolean }) => void;
  openForkModal: (conv: Conversation) => void;
  submitFork: (conv: Conversation, launchModel: string, summaryModel: string, plainFork: boolean, localSummaryOnly: boolean, includeThinkingInSummary: boolean) => void;
  forkTarget: Conversation | null;
  closeForkModal: () => void;
  isForkPending: boolean;
}

export function useConversationMutations(
  selectedConversation: string | null,
  onSelectConversation: (name: string | null) => void,
): ConversationMutations {
  const queryClient = useQueryClient();
  const [forkTarget, setForkTarget] = useState<Conversation | null>(null);

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

  const favoriteMutation = useMutation({
    mutationFn: ({ name, favorited }: { name: string; favorited: boolean }) =>
      favorited ? unfavoriteConversation(name) : favoriteConversation(name),
    onMutate: async ({ name, favorited }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const prev = queryClient.getQueryData<Conversation[]>(['conversations']);
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === name ? { ...c, isFavorited: !favorited } : c)) ?? [],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['conversations'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const summaryForkMutation = useMutation({
    mutationFn: summaryForkConversation,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const msg = variables.plain
        ? 'Plain fork started — copying conversation history...'
        : 'Fork started — summarizing conversation...';
      toast.success(msg, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
      console.error('Summary fork failed:', err);
    },
  });

  const openForkModal = useCallback((conv: Conversation) => {
    if (!summaryForkMutation.isPending) {
      setForkTarget(conv);
    }
  }, [summaryForkMutation.isPending]);

  const submitFork = useCallback((conv: Conversation, launchModel: string, summaryModel: string, plainFork: boolean, localSummaryOnly: boolean, includeThinkingInSummary: boolean) => {
    summaryForkMutation.mutate({
      conv,
      model: launchModel,
      summaryModel,
      plain: plainFork,
      localSummaryOnly,
      includeThinkingInSummary,
    });
    setForkTarget(null);
  }, [summaryForkMutation]);

  return {
    archive: (name) => archiveMutation.mutate(name),
    stop: (name) => { if (!stopMutation.isPending) stopMutation.mutate(name); },
    rename: (opts) => renameMutation.mutate(opts),
    toggleFavorite: (opts) => favoriteMutation.mutate(opts),
    openForkModal,
    submitFork,
    forkTarget,
    closeForkModal: () => setForkTarget(null),
    isForkPending: summaryForkMutation.isPending,
  };
}

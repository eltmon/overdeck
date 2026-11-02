import { useState, useCallback, useMemo, useRef } from 'react';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Conversation } from './ConversationList';
import { updateConversationTitle } from './ConversationList';
import { closeConversationPanes } from '../../lib/panesStore';

// Shared across hook instances so every view sees a pending archive (PAN-4584).
const ARCHIVE_MUTATION_KEY = ['conversation-archive'] as const;
// Shared across hook instances so every view sees a pending stop (PAN-4626).
const STOP_MUTATION_KEY = ['conversation-stop'] as const;

async function archiveConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/archive`, { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to archive conversation');
}

async function stopConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to stop conversation');
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

async function moveConversation(name: string, projectKey: string): Promise<{ projectKey: string | null }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to move conversation');
  return data as { projectKey: string | null };
}

// PAN-3822: explicit PR links. `ref` is a PR/MR URL, #42, or owner/repo#42.
async function linkConversationPullRequest(name: string, ref: string): Promise<{ repository: string; number: number }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/pull-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to link pull request');
  return data as { repository: string; number: number };
}

async function unlinkConversationPullRequest(name: string, ref: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/pull-requests?ref=${encodeURIComponent(ref)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to unlink pull request');
}

// ─── Triage (PAN-4639 WI-6) ─────────────────────────────────────────────────

export interface TriageUpdateInput {
  name: string;
  settled?: boolean;
  settleReason?: 'manual' | 'merge' | 'idle';
  snoozedUntil?: string | null;
  autoSettleOverride?: 'on' | 'off' | 'inherit';
}

interface TriageState {
  settledAt: string | null;
  settleReason: 'manual' | 'merge' | 'idle' | null;
  snoozedUntil: string | null;
}

interface TriageUndoEntry {
  label: string;
  priors: Array<{ name: string; prior: TriageState }>;
}

interface TriageMutationVars {
  updates: TriageUpdateInput[];
  label: string;
  isUndo?: boolean;
}

// D11: one history shared by every useConversationMutations instance, so Undo
// and Cmd/Ctrl+Z see the same stack regardless of which view triggered a change.
const TRIAGE_UNDO_STACK_MAX = 20;
let triageUndoStack: TriageUndoEntry[] = [];

export function __resetTriageUndoStackForTests(): void {
  triageUndoStack = [];
}

function removeTriageUndoEntry(entry: TriageUndoEntry): void {
  const index = triageUndoStack.indexOf(entry);
  if (index !== -1) triageUndoStack.splice(index, 1);
}

function triageStateOf(conv: Conversation | undefined): TriageState {
  return {
    settledAt: conv?.settledAt ?? null,
    settleReason: conv?.settleReason ?? null,
    snoozedUntil: conv?.snoozedUntil ?? null,
  };
}

/** D3 mutual exclusion, mirroring conversation-triage-store.applyTriageUpdate server-side. */
function applyTriageOptimistic(prior: TriageState, update: TriageUpdateInput, nowIso: string): TriageState {
  let next = prior;
  if (update.snoozedUntil !== undefined) {
    next = update.snoozedUntil === null
      ? { ...next, snoozedUntil: null }
      : { settledAt: null, settleReason: null, snoozedUntil: update.snoozedUntil };
  }
  if (update.settled !== undefined) {
    next = update.settled
      ? {
          settledAt: next.settledAt ?? nowIso,
          settleReason: next.settledAt ? next.settleReason : (update.settleReason ?? 'manual'),
          snoozedUntil: null,
        }
      : { settledAt: null, settleReason: null, snoozedUntil: next.snoozedUntil };
  }
  return next;
}

/** The API contract's undo replay: restore exactly the prior triage triple. */
function triagePriorToUpdate(name: string, prior: TriageState): TriageUpdateInput {
  return { name, settled: prior.settledAt !== null, settleReason: prior.settleReason ?? undefined, snoozedUntil: prior.snoozedUntil };
}

async function postTriageUpdates(updates: TriageUpdateInput[]): Promise<void> {
  const res = await fetch('/api/conversations/triage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to update conversation triage');
}

type ApiForkMode = 'summary' | 'plain' | 'handoff';
type ForkModeOption = ApiForkMode | 'fast-summary';
type HandoffAuthor = 'source' | 'external';

async function summaryForkConversation(opts: { conv: Conversation; model: string; summaryModel: string; harness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent'; summaryHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent'; forkMode?: ApiForkMode; focus?: string; localSummaryOnly?: boolean; includeThinkingInSummary?: boolean; title?: string; handoffAuthor?: HandoffAuthor; handoffAuthorModel?: string; handoffAuthorHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent'; projectKey?: string; handoffExtras?: { skills?: string[]; packs?: string[]; hold?: boolean; fresh?: boolean } }): Promise<void> {
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
      handoffAuthor: opts.handoffAuthor,
      handoffAuthorModel: opts.handoffAuthorModel,
      handoffAuthorHarness: opts.handoffAuthorHarness,
      projectKey: opts.projectKey,
      ...(opts.handoffExtras?.skills?.length ? { skills: opts.handoffExtras.skills } : {}),
      ...(opts.handoffExtras?.packs?.length ? { packs: opts.handoffExtras.packs } : {}),
      ...(opts.handoffExtras?.hold ? { hold: true } : {}),
      ...(opts.handoffExtras?.fresh ? { fresh: true } : {}),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to create summary fork');
  }
}

export interface ConversationMutations {
  archive: (name: string, options?: { onSuccess?: () => void }) => void;
  isArchivePending: (name: string) => boolean;
  stop: (name: string) => void;
  isStopPending: (name: string) => boolean;
  rename: (opts: { name: string; title: string }) => void;
  retitle: (name: string) => void;
  isRetitlePending: (name: string) => boolean;
  toggleFavorite: (opts: { name: string; favorited: boolean }) => void;
  move: (opts: { name: string; projectKey: string; projectName: string }) => void;
  linkPullRequest: (opts: { name: string; ref: string }) => void;
  unlinkPullRequest: (opts: { name: string; ref: string }) => void;
  /** PAN-4639: apply triage updates (one request), push an undo entry, toast with Undo. */
  triage: (opts: { updates: TriageUpdateInput[]; label: string }) => void;
  /** Pops the newest undo entry and replays its priors. Returns false when the stack is empty. */
  undoLastTriage: () => boolean;
  /** PAN-4653: set one conversation's auto-settle-on-merge override (no undo entry). */
  setAutoSettleOverride: (opts: { name: string; override: 'on' | 'off' | 'inherit' }) => void;
  openForkModal: (conv: Conversation, options?: { mode?: ForkModeOption; focus?: string }) => void;
  submitFork: (conv: Conversation, launchModel: string, summaryModel: string, forkMode: ApiForkMode, localSummaryOnly: boolean, includeThinkingInSummary: boolean, title?: string, launchHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', summaryHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', focus?: string, handoffAuthor?: HandoffAuthor, handoffAuthorModel?: string, handoffAuthorHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', projectKey?: string, handoffExtras?: { skills?: string[]; packs?: string[]; hold?: boolean; fresh?: boolean }) => void;
  forkTarget: Conversation | null;
  forkTargetMode: ForkModeOption | undefined;
  forkTargetFocus: string | undefined;
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
  const [forkTargetFocus, setForkTargetFocus] = useState<string | undefined>(undefined);
  const pendingFavoriteNamesRef = useRef(new Set<string>());

  const archiveMutation = useMutation({
    mutationKey: ARCHIVE_MUTATION_KEY,
    mutationFn: archiveConversation,
    onMutate: (name: string) => {
      const title = queryClient.getQueryData<Conversation[]>(['conversations'])
        ?.find((c) => c.name === name)?.title ?? name;
      return { title };
    },
    onSuccess: async (_data, name, ctx) => {
      // Awaited so the mutation stays pending (row dimmed) until the
      // refetched list drops the row (PAN-4626).
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      // An archived conversation leaves the list — close its deck tab(s) too.
      closeConversationPanes(name);
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
      toast.success(`Archived "${ctx?.title ?? name}"`, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  const pendingArchiveNames = useMutationState({
    filters: { mutationKey: ARCHIVE_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as string,
  });

  const stopMutation = useMutation({
    mutationKey: STOP_MUTATION_KEY,
    mutationFn: stopConversation,
    onSuccess: async (_data, name) => {
      // Awaited so the mutation stays pending (row dimmed) until the
      // refetched list reflects the stopped session (PAN-4626).
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  const pendingStopNames = useMutationState({
    filters: { mutationKey: STOP_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as string,
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

  const moveMutation = useMutation({
    mutationFn: (vars: { name: string; projectKey: string; projectName: string }) =>
      moveConversation(vars.name, vars.projectKey),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previous = queryClient.getQueryData<Conversation[]>(['conversations']);
      const title = previous?.find((c) => c.name === vars.name)?.title ?? vars.name;
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === vars.name ? { ...c, projectKey: vars.projectKey } : c)) ?? [],
      );
      return { previous, title };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['conversations'], ctx.previous);
      toast.error(err.message, { duration: 6000 });
    },
    onSuccess: (data, vars, ctx) => {
      // Settle the cache with the server-confirmed projectKey directly;
      // other clients converge via the conversation.moved domain event. An
      // unconditional invalidate here would double the list refetch.
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === vars.name ? { ...c, projectKey: data.projectKey } : c)) ?? [],
      );
      toast.success(`Moved "${ctx?.title ?? vars.name}" to ${vars.projectName}`, { duration: 4000 });
    },
    onSettled: (_data, error) => {
      // onError already rolled back to the pre-mutation snapshot; re-sync
      // from the server only on failure, since that snapshot may not reflect
      // a concurrent change from elsewhere.
      if (error) queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const invalidatePullRequests = (name: string) => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation-pull-requests', name] });
  };
  const linkPullRequestMutation = useMutation({
    mutationFn: (vars: { name: string; ref: string }) => linkConversationPullRequest(vars.name, vars.ref),
    onSuccess: (link, vars) => {
      invalidatePullRequests(vars.name);
      toast.success(`Linked ${link.repository}#${link.number}`, { duration: 4000 });
    },
    onError: (err: Error) => { toast.error(err.message, { duration: 6000 }); },
  });
  const unlinkPullRequestMutation = useMutation({
    mutationFn: (vars: { name: string; ref: string }) => unlinkConversationPullRequest(vars.name, vars.ref),
    onSuccess: (_data, vars) => {
      invalidatePullRequests(vars.name);
      toast.success('Pull request unlinked', { duration: 4000 });
    },
    onError: (err: Error) => { toast.error(err.message, { duration: 6000 }); },
  });

  const triageMutation = useMutation({
    mutationFn: (vars: TriageMutationVars) => postTriageUpdates(vars.updates),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const nowIso = new Date().toISOString();
      const current = queryClient.getQueryData<Conversation[]>(['conversations']) ?? [];
      const byName = new Map(current.map((c) => [c.name, c]));
      const priors = vars.updates.map((update) => ({ name: update.name, prior: triageStateOf(byName.get(update.name)) }));
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => {
          const update = vars.updates.find((u) => u.name === c.name);
          return update ? { ...c, ...applyTriageOptimistic(triageStateOf(c), update, nowIso) } : c;
        }) ?? [],
      );
      return { priors };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.priors) {
        queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
          old?.map((c) => {
            const found = ctx.priors.find((p) => p.name === c.name);
            return found ? { ...c, ...found.prior } : c;
          }) ?? [],
        );
      }
      toast.error(err.message, { duration: 6000 });
    },
    onSuccess: (_data, vars, ctx) => {
      if (vars.isUndo || !ctx?.priors || ctx.priors.length === 0) {
        if (!vars.isUndo) toast(vars.label, { duration: 6000 });
        return;
      }
      const entry: TriageUndoEntry = { label: vars.label, priors: ctx.priors };
      triageUndoStack.push(entry);
      if (triageUndoStack.length > TRIAGE_UNDO_STACK_MAX) triageUndoStack.shift();
      toast(vars.label, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            removeTriageUndoEntry(entry);
            triageMutation.mutate({
              updates: entry.priors.map(({ name, prior }) => triagePriorToUpdate(name, prior)),
              label: entry.label,
              isUndo: true,
            });
          },
        },
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const summaryForkMutation = useMutation({
    mutationFn: summaryForkConversation,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const msg = variables.handoffExtras?.fresh
        ? 'Fresh conversation started — no summary, no parent link'
        : variables.forkMode === 'plain'
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

  const openForkModal = useCallback((conv: Conversation, options?: { mode?: ForkModeOption; focus?: string }) => {
    if (!summaryForkMutation.isPending) {
      setForkTarget(conv);
      setForkTargetMode(options?.mode);
      setForkTargetFocus(options?.focus);
    }
  }, [summaryForkMutation.isPending]);

  // Depends on the stable `.mutate`, not the mutation result object, which
  // TanStack rebuilds every render (PAN-4560).
  const summaryForkMutate = summaryForkMutation.mutate;
  const submitFork = useCallback((conv: Conversation, launchModel: string, summaryModel: string, forkMode: ApiForkMode, localSummaryOnly: boolean, includeThinkingInSummary: boolean, title?: string, launchHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', summaryHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', focus?: string, handoffAuthor?: HandoffAuthor, handoffAuthorModel?: string, handoffAuthorHarness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent', projectKey?: string, handoffExtras?: { skills?: string[]; packs?: string[]; hold?: boolean; fresh?: boolean }) => {
    summaryForkMutate({
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
      handoffAuthor,
      handoffAuthorModel,
      handoffAuthorHarness,
      projectKey,
      handoffExtras,
    });
    setForkTarget(null);
    setForkTargetMode(undefined);
    setForkTargetFocus(undefined);
  }, [summaryForkMutate]);

  // PAN-4560: one object per meaningful change, so the memoized conversation
  // list items do not all re-render on every list render. TanStack keeps each
  // `.mutate` stable; retitleVersion is a dependency so isRetitlePending
  // re-evaluates after pending changes, and pendingArchiveNames /
  // pendingStopNames are dependencies so isArchivePending / isStopPending do too.
  // PAN-4653 D10: the override is a preference, not a triage move — no undo entry, no success toast.
  const autoSettleOverrideMutation = useMutation({
    mutationFn: ({ name, override }: { name: string; override: 'on' | 'off' | 'inherit' }) =>
      postTriageUpdates([{ name, autoSettleOverride: override }]),
    onMutate: async ({ name, override }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const current = queryClient.getQueryData<Conversation[]>(['conversations']) ?? [];
      const prior = current.find((c) => c.name === name)?.autoSettleOverride ?? 'inherit';
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === name ? { ...c, autoSettleOverride: override } : c)) ?? [],
      );
      return { name, prior };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
          old?.map((c) => (c.name === ctx.name ? { ...c, autoSettleOverride: ctx.prior } : c)) ?? [],
        );
      }
      toast.error(err.message, { duration: 6000 });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const archiveMutate = archiveMutation.mutate;
  const stopMutate = stopMutation.mutate;
  const renameMutate = renameMutation.mutate;
  const retitleMutate = retitleMutation.mutate;
  const favoriteMutate = favoriteMutation.mutate;
  const moveMutate = moveMutation.mutate;
  const linkPullRequestMutate = linkPullRequestMutation.mutate;
  const unlinkPullRequestMutate = unlinkPullRequestMutation.mutate;
  const triageMutate = triageMutation.mutate;
  const autoSettleOverrideMutate = autoSettleOverrideMutation.mutate;
  const isForkPending = summaryForkMutation.isPending;
  return useMemo<ConversationMutations>(() => ({
    archive: (name, options) => {
      if (queryClient.isMutating({ mutationKey: ARCHIVE_MUTATION_KEY, predicate: (m) => m.state.variables === name }) > 0) return;
      archiveMutate(name, options?.onSuccess ? { onSuccess: () => options.onSuccess?.() } : undefined);
    },
    isArchivePending: (name) => pendingArchiveNames.includes(name),
    stop: (name) => {
      if (queryClient.isMutating({ mutationKey: STOP_MUTATION_KEY, predicate: (m) => m.state.variables === name }) > 0) return;
      stopMutate(name);
    },
    isStopPending: (name) => pendingStopNames.includes(name),
    rename: (opts) => renameMutate(opts),
    retitle: (name) => {
      if (pendingRetitleNamesRef.current.has(name)) return;
      retitleMutate(name);
    },
    isRetitlePending: (name) => pendingRetitleNamesRef.current.has(name),
    toggleFavorite: (opts) => {
      if (pendingFavoriteNamesRef.current.has(opts.name)) return;
      favoriteMutate(opts);
    },
    move: (opts) => moveMutate(opts),
    linkPullRequest: (opts) => linkPullRequestMutate(opts),
    unlinkPullRequest: (opts) => unlinkPullRequestMutate(opts),
    triage: (opts) => triageMutate({ updates: opts.updates, label: opts.label }),
    undoLastTriage: () => {
      const entry = triageUndoStack.pop();
      if (!entry) return false;
      triageMutate({
        updates: entry.priors.map(({ name, prior }) => triagePriorToUpdate(name, prior)),
        label: entry.label,
        isUndo: true,
      });
      return true;
    },
    setAutoSettleOverride: (opts) => autoSettleOverrideMutate(opts),
    openForkModal,
    submitFork,
    forkTarget,
    forkTargetMode,
    forkTargetFocus,
    closeForkModal: () => { setForkTarget(null); setForkTargetMode(undefined); setForkTargetFocus(undefined); },
    isForkPending,
  }), [archiveMutate, pendingArchiveNames, queryClient, stopMutate, pendingStopNames, renameMutate, retitleMutate, favoriteMutate, moveMutate, linkPullRequestMutate, unlinkPullRequestMutate, triageMutate, autoSettleOverrideMutate, openForkModal, submitFork, forkTarget, forkTargetMode, forkTargetFocus, isForkPending, retitleVersion]);
}

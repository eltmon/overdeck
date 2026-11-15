/**
 * useIssueSessionActions — the deck's issue and session handlers (PAN-5293
 * WI-4, moved from CommandDeck/index.tsx): select an issue or session, open
 * its terminal or transcript, stop/pause/resume/unpause/restart a session,
 * deep wipe, clean up orphaned resources, and open the Plan dialog.
 *
 * Selection writes go to `useCommandDeckSelection`. Every pane-opening
 * handler opens the pane through `panesStore`, then calls `openInDeck`, so
 * the same handler works from the deck and from the left column.
 */

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent, Issue, StartAgentResponse } from '../../../types';
import type { Harness } from '../../shared/ModelPicker';
import { useDashboardStore } from '../../../lib/store';
import { usePanesStore } from '../../../lib/panesStore';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../../lib/pending-codex-spawn';
import { openRecoveryForStartBlock } from '../../../lib/resumeRecovery';
import { getDirectRestartRequest } from '../../../lib/restartRouting';
import { useConfirm } from '../../DialogProvider';
import { useDeckNavigation } from './deckNavigation';
import { useDeckProjects } from './useDeckProjects';

/** The issue whose Plan dialog is open, shared by the handlers and DeckDialogsHost. */
export const useDeckDialogs = create<{
  planDialogIssue: Issue | null;
  setPlanDialogIssue: (issue: Issue | null) => void;
}>((set) => ({
  planDialogIssue: null,
  setPlanDialogIssue: (issue) => set({ planDialogIssue: issue }),
}));

const setSelectedFeature = (id: string | null) => useCommandDeckSelection.getState().setSelectedFeature(id);
const setSelectedConversation = (name: string | null) => useCommandDeckSelection.getState().setSelectedConversation(name);

// ── Project-deck tab helpers (PAN-1561) ──────────────────────────────────────
// Open/focus tabs in a project's deck directly via the shared panesStore (the
// same store the Stage reads). They take an explicit project key so the
// deep-link effect can target a project before selection state settles.
export function openIssueTabIn(projectKey: string, issueId: string, label: string): void {
  const store = usePanesStore.getState();
  store.ensureHome(projectKey);
  const panes = store.panesByWorkspace[projectKey] ?? [];
  const existing = panes.find((p) => p.paneType === 'issue' && p.issueId === issueId);
  if (existing) store.setActivePane(projectKey, existing.paneId);
  else store.addPane(projectKey, { paneType: 'issue', label, issueId });
}

export function openTerminalTabIn(projectKey: string, sessionId: string): void {
  const store = usePanesStore.getState();
  store.ensureHome(projectKey);
  store.addPane(projectKey, { paneType: 'terminal', label: 'Terminal', terminalId: sessionId });
}

// Open a session-backed agent pane (clicking an agent in the rail tree). The pane
// carries the sessionId on `agentId` and the owning issue on `issueId`; Stage's
// resolveSession turns that into the live SessionNode → SessionPanel.
export function openSessionPaneIn(projectKey: string, sessionId: string, issueId: string, label: string): void {
  const store = usePanesStore.getState();
  store.ensureHome(projectKey);
  const panes = store.panesByWorkspace[projectKey] ?? [];
  const existing = panes.find((p) => p.paneType === 'agent' && p.agentId === sessionId);
  if (existing) store.setActivePane(projectKey, existing.paneId);
  else store.addPane(projectKey, { paneType: 'agent', label, agentId: sessionId, issueId });
}


export function useIssueSessionActions(deckKey: string | null) {
  const queryClient = useQueryClient();
  // PAN-1985: confirmation for the destructive harness/model switch paths on
  // work and review sessions. Resumed sessions (no model/harness change) skip
  // the dialog.
  const confirm = useConfirm();
  const { openInDeck } = useDeckNavigation();
  const { projectsWithSessions, sessionTreeMap } = useDeckProjects();
  const selectSession = useCommandDeckSelection((s) => s.selectSession);

  // PAN-1561: selecting an issue from the tree opens (or focuses) an issue tab
  // in the current project's deck rather than replacing the whole content area.
  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
    if (deckKey) {
      openIssueTabIn(deckKey, issueId, issueId);
      openInDeck({ projectKey: deckKey, issueId });
    }

    const feature = projectsWithSessions
      .flatMap(p => p.features)
      .find(f => f.issueId === issueId);
    const activeWorkSession = feature?.sessions?.find(
      (s) => s.presence === 'active' && s.type === 'work',
    );
    selectSession(issueId, activeWorkSession?.sessionId ?? null);
  }, [selectSession, projectsWithSessions, deckKey, openInDeck]);

  const handleSelectSession = useCallback((issueId: string, sessionId: string) => {
    setSelectedFeature(issueId);
    selectSession(issueId, sessionId);
    setSelectedConversation(null);
    if (!deckKey) return;
    // Clicking an agent in the rail tree opens THAT agent's conversation (SessionPanel),
    // not the issue tab. Label from the session's role/type (e.g. "Security", "Work").
    const session = projectsWithSessions
      .flatMap((p) => p.features)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.sessionId === sessionId);
    const raw = session?.role ?? session?.type ?? 'Agent';
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    openSessionPaneIn(deckKey, sessionId, issueId, label);
    openInDeck({ projectKey: deckKey });
  }, [selectSession, deckKey, projectsWithSessions, openInDeck]);

  const handleStopSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to stop session');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop session');
    }
  }, [queryClient]);

  const handleCleanupOrphanedResources = useCallback(async (issueId: string) => {
    if (!window.confirm(`Clean up orphaned resources for ${issueId}? This removes leftover local workspace state for a closed issue.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/cleanup-workspace`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clean up orphaned resources');
      await queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clean up resources');
    }
  }, [queryClient]);

  const handleViewTerminal = useCallback((sessionId: string) => {
    // Find which issue owns this session, highlight it, and open a terminal tab
    // for the session in the project deck.
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          if (deckKey) {
            openTerminalTabIn(deckKey, sessionId);
            openInDeck({ projectKey: deckKey });
          }
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession, deckKey, openInDeck]);

  const handlePauseSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error('Failed to pause session');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause session');
    }
  }, [queryClient]);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    try {
      console.log(`[command-deck] handleResumeSession ${sessionId}`);
      const res = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from dashboard' }),
      });
      const data = await res.json().catch(() => ({})) as { messageDelivered?: boolean; error?: string };
      if (!res.ok) {
        console.warn(`[command-deck] handleResumeSession ${sessionId} failed: ${res.status} ${data.error ?? 'no body'}`);
        throw new Error(data.error || 'Failed to resume session');
      }
      console.log(`[command-deck] handleResumeSession ${sessionId} ok: messageDelivered=${data.messageDelivered}`);
      toast.success(data.messageDelivered === false
        ? 'Agent resumed; message queued in mail (PTY echo-confirm timed out)'
        : 'Agent resumed');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume session');
    }
  }, [queryClient]);

  // PAN-1779: clear a persistent pause gate. Distinct from resume — unpause
  // removes the gate without spawning; the deacon's next patrol resumes it.
  const handleUnpauseSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unpause agent');
      toast.success('Agent unpaused — deacon will resume it on the next patrol');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpause agent');
    }
  }, [queryClient]);

  const handleRestartSession = useCallback(async (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => {
    try {
      // Find project key for this issue. Primary: resource-allocated issue list.
      // Fallback: session tree (covers issues where the work agent is done but
      // review is still running — those drop off resource-allocated but stay in the tree).
      const projectKey = projectsWithSessions.find(p =>
        p.features.some(f => f.issueId === issueId),
      )?.name
        ?? Object.entries(sessionTreeMap).find(([, tree]) =>
          tree.features.some(f => f.issueId.toLowerCase() === issueId.toLowerCase()),
        )?.[0];

      // PAN-1985: detect whether this picker click is actually changing the
      // work agent's harness or model, so we can route to the wipe+respawn
      // path instead of the cheap resume path. Same-harness, no-model
      // selections ("Default role config") keep the resume-first behavior;
      // any explicit harness or model change goes through the destructive
      // restart-fresh route after a typed confirmation.
      const isWorkSession = !sessionType || sessionType === 'work';
      const currentAgent = isWorkSession
        ? useDashboardStore.getState().agentsById[sessionId] as unknown as Agent | undefined
        : undefined;
      const currentHarness = currentAgent?.harness ?? undefined;
      const currentModel = currentAgent?.model ?? undefined;
      const harnessIsChanging = isWorkSession
        && harness !== undefined
        && harness !== currentHarness
        && currentHarness !== undefined;
      const modelIsChanging = isWorkSession
        && model !== undefined
        && model !== currentModel
        && currentModel !== undefined
        && !harnessIsChanging; // harness change implies model change too
      const isDestructiveWorkChange = harnessIsChanging || modelIsChanging;
      const isDestructiveReview = sessionType === 'review' || sessionType === 'reviewer';

      if (isDestructiveWorkChange || isDestructiveReview) {
        const confirmTitle = isDestructiveReview
          ? 'Re-run review on latest commit with new harness/model'
          : 'Restart work agent with new harness/model';
        const reviewMessage = `This will delete the review agent's state for ${issueId} (sessions, activity, logs) and start a fresh review run with the chosen harness/model.\n\nThe workspace, xBRIEF, tasks, and commit history are kept. The review will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model or force-restarting the review.`;
        const workMessage = `This will delete the work agent's state for ${issueId} (sessions, activity, logs) and start a fresh ${harness ?? currentHarness ?? ''} + ${model ?? currentModel ?? ''} agent.\n\nThe workspace, xBRIEF, tasks, and commit history are kept. The new agent will read .pan/continue.json and the branch to continue. The agent will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model.`;
        const confirmed = await confirm({
          title: confirmTitle,
          message: isDestructiveReview ? reviewMessage : workMessage,
          confirmLabel: isDestructiveReview ? 'Re-run review' : 'Restart work agent',
          variant: 'destructive',
        });
        if (!confirmed) {
          toast.info('Restart canceled');
          return;
        }
      }

      const directRestartRequest = getDirectRestartRequest({ projectKey, issueId, sessionId, sessionType, role, model, harness });
      if (directRestartRequest && !isDestructiveWorkChange) {
        // Note: isDestructiveWorkChange is false here because it's a work
        // session, but we still gate the direct path to avoid double-routing
        // in the rare case a future change makes getDirectRestartRequest
        // return for work sessions too.
        const res = await fetch(directRestartRequest.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(directRestartRequest.body),
        });
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) throw new Error(data.error || directRestartRequest.errorMessage);
        toast.success(directRestartRequest.successMessage);
        await refreshDashboardState(queryClient);
        return;
      }

      // PAN-1985: destructive work-agent change. Wipe the work agent dir and
      // respawn a fresh agent with the chosen harness/model. The user has
      // already confirmed; do not fall through to the cheap resume path.
      if (isDestructiveWorkChange) {
        const restartFreshRes = await fetch(`/api/agents/${sessionId}/restart-fresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spawn: true,
            ...(model ? { model } : {}),
            ...(harness ? { harness } : {}),
          }),
        });
        const restartFreshData = await restartFreshRes.json().catch(() => ({})) as {
          success?: boolean;
          error?: string;
          spawnedModel?: string;
          spawnedHarness?: string;
        };
        if (!restartFreshRes.ok) {
          // A live-session 409 offers Stop & restart with the SAME payload —
          // never the raw 'pan kill' instruction text.
          if (openRecoveryForStartBlock(restartFreshRes.status, restartFreshData, issueId, {
            url: `/api/agents/${sessionId}/restart-fresh`,
            body: { spawn: true, ...(model ? { model } : {}), ...(harness ? { harness } : {}) },
          })) return;
          throw new Error(restartFreshData.error || 'Failed to restart agent with new harness/model');
        }
        toast.success(
          `Agent restarted: ${restartFreshData.spawnedHarness ?? harness} + ${restartFreshData.spawnedModel ?? model}`,
        );
        await refreshDashboardState(queryClient);
        return;
      }

      // Default: work agent restart. Try resume first — Claude sessions are never
      // discarded. Only start fresh if the agent has no saved session to resume.
      const resumeRes = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          ...(harness ? { harness } : {}),
        }),
      });
      const resumeData = await resumeRes.json().catch(() => ({})) as { success?: boolean; error?: string; lifecycle?: { canResumeSession?: boolean; hasLivePane?: boolean; isRunning?: boolean } };
      if (resumeRes.ok) {
        toast.success('Agent resumed');
        await refreshDashboardState(queryClient);
        return;
      }
      // Agent is currently running — true restart: stop it, then resume from saved session.
      if (resumeData.lifecycle?.isRunning) {
        const stopRes = await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
        if (!stopRes.ok) throw new Error('Failed to stop agent before restart');
        const resumeRetryRes = await fetch(`/api/agents/${sessionId}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(model ? { model } : {}),
            ...(harness ? { harness } : {}),
          }),
        });
        if (!resumeRetryRes.ok) {
          const retryData = await resumeRetryRes.json().catch(() => ({})) as { error?: string };
          if (openRecoveryForStartBlock(resumeRetryRes.status, retryData, issueId)) return;
          throw new Error(retryData.error || 'Failed to restart agent');
        }
        toast.success('Agent restarted');
        await refreshDashboardState(queryClient);
        return;
      }
      // Only fall through to start-fresh when there is genuinely no session to resume.
      const noSession = resumeData.lifecycle?.canResumeSession === false && !resumeData.lifecycle?.hasLivePane;
      if (!noSession) {
        // A gate/resumable 409 opens the recovery dialog instead of toasting CLI text.
        if (openRecoveryForStartBlock(resumeRes.status, resumeData, issueId)) return;
        throw new Error(resumeData.error || 'Failed to resume agent');
      }

      // No saved session — start fresh.
      await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      const requestBody: Record<string, unknown> = { issueId };
      if (model) requestBody.model = model;
      if (harness) requestBody.harness = harness;
      let lastRequestBody = requestBody;
      let res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRequestBody),
      });
      let data = await res.json().catch(() => ({})) as StartAgentResponse;
      if (res.status === 409 && data.requiresAcknowledgement) {
        const confirmed = window.confirm((data.guardrails?.warnings ?? []).map((warning) => `• ${warning.message}`).join('\n'));
        if (!confirmed) throw new Error('Agent start canceled');
        lastRequestBody = { ...requestBody, guardrailAcknowledged: true };
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRequestBody),
        });
        data = await res.json().catch(() => ({})) as StartAgentResponse;
      }
      if (!res.ok) {
        if (isCodexBlockedResponse(res, data)) {
          setPendingCodexSpawn(lastRequestBody);
          throw new Error(data.hint || data.error || 'Codex authentication expired — re-authenticate to continue');
        }
        // Start-block 409s open the recovery dialog instead of toasting CLI text.
        if (openRecoveryForStartBlock(res.status, data, issueId)) return;
        throw new Error(data.error || data.hint || 'Failed to start agent');
      }
      if (data.guardrails?.warnings?.length) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restart session');
    }
  }, [queryClient, projectsWithSessions, sessionTreeMap, confirm]);

  const handleDeepWipe = useCallback(async (issueId: string) => {
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/deep-wipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: true }),
      });
      if (!res.ok) throw new Error('Failed to deep wipe');
      await refreshDashboardState(queryClient);
      // Deselect the feature since its workspace is gone
      setSelectedFeature(null);
      selectSession(issueId, null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deep wipe');
    }
  }, [queryClient, selectSession]);

  const handleOpenStateDir = useCallback((sessionId: string) => {
    const path = `~/.overdeck/agents/${sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
  }, []);

  const handleOpenPlanDialog = useCallback((issueId: string) => {
    const issues = useDashboardStore.getState().issuesRaw as Issue[];
    const found = issues.find(i => i.identifier.toLowerCase() === issueId.toLowerCase());
    // Never silently no-op: if the issue isn't in the loaded `issues` list (filtered/
    // paginated/out-of-sync), synthesize a minimal one so the dialog still opens.
    const issue = found ?? ({
      id: issueId, identifier: issueId, title: issueId, status: 'Todo',
      priority: 0, labels: [], url: '', createdAt: '', updatedAt: '',
    } as unknown as Issue);
    useDeckDialogs.getState().setPlanDialogIssue(issue);
  }, []);

  const handleViewJsonl = useCallback((sessionId: string) => {
    // Highlight the owning issue and open its tab so its transcript is reachable.
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          if (deckKey) {
            openIssueTabIn(deckKey, feature.issueId, feature.issueId);
            openInDeck({ projectKey: deckKey });
          }
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession, deckKey, openInDeck]);

  return useMemo(() => ({
    handleSelectFeature,
    handleSelectSession,
    handleStopSession,
    handleCleanupOrphanedResources,
    handleViewTerminal,
    handlePauseSession,
    handleResumeSession,
    handleUnpauseSession,
    handleRestartSession,
    handleDeepWipe,
    handleOpenStateDir,
    handleOpenPlanDialog,
    handleViewJsonl,
  }), [handleSelectFeature, handleSelectSession, handleStopSession, handleCleanupOrphanedResources, handleViewTerminal, handlePauseSession, handleResumeSession, handleUnpauseSession, handleRestartSession, handleDeepWipe, handleOpenStateDir, handleOpenPlanDialog, handleViewJsonl]);
}

export type IssueSessionActions = ReturnType<typeof useIssueSessionActions>;

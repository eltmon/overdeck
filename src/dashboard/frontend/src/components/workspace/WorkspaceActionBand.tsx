/**
 * PAN-3331 — the workspace quick-action band.
 *
 * Sits between WorkspaceView's header and its panels for every workspace kind
 * and answers the three questions the view used to leave unanswered: is my
 * checkout current with its remote, how do I run this thing, and how do I open
 * it in my other tools.
 *
 * Freshness is real, not implied: the git query asks the server to fetch on
 * mount and on the manual refresh (the server throttles to one fetch per 30s
 * per path), while the 30s poll re-reads without forcing one.
 *
 * Pull is fast-forward only and kind-aware — an issue workspace goes through
 * the existing sync-main flow, whose merge semantics this feature does not
 * touch; main and scratch use the ff-only pull route.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface RemoteCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

export interface WorkspaceGitState {
  branch: string | null;
  detached: boolean;
  dirtyFiles: number;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  upstreamRef: string | null;
  recentRemoteCommits: RemoteCommit[];
  fetchedAt: number | null;
}

export interface WorkspaceActionBandProps {
  workspaceId: string;
  kind: 'main' | 'issue' | 'scratch';
  issueId: string | null;
  isGitRepository: boolean;
  runCommand: string | null;
  runCommandDefault: string | null;
  runCommandOptions: Array<{ name: string; command: string }>;
  openInEditorConfigured: boolean;
  /** The live run session, lifted so WorkspaceView can host its terminal in the panel area. */
  runSessionName: string | null;
  onRunSessionChange: (sessionName: string | null) => void;
}

/**
 * Which run session belongs to which workspace, for this browser session only.
 * The command palette can start a run before the workspace view mounts, and a
 * view remounted by navigation would otherwise show no terminal for a session
 * that is very much alive.
 *
 * It is a subscribable store rather than a plain map because both readers need
 * to react: the view is NOT remounted when the route changes workspace id, so a
 * once-only read would leave workspace A's terminal and Stop button showing
 * inside workspace B; and a palette start for the already-mounted workspace
 * would update the map with nothing re-rendering.
 */
const runSessionsByWorkspace = new Map<string, string>();
const runSessionListeners = new Set<() => void>();

export function rememberRunSession(workspaceId: string, sessionName: string | null): void {
  if (sessionName) runSessionsByWorkspace.set(workspaceId, sessionName);
  else runSessionsByWorkspace.delete(workspaceId);
  for (const listener of runSessionListeners) listener();
}

export function recallRunSession(workspaceId: string): string | null {
  return runSessionsByWorkspace.get(workspaceId) ?? null;
}

function subscribeRunSessions(listener: () => void): () => void {
  runSessionListeners.add(listener);
  return () => { runSessionListeners.delete(listener); };
}

/** The live run session for one workspace, re-rendering whenever it changes. */
export function useRunSession(workspaceId: string): string | null {
  return useSyncExternalStore(
    subscribeRunSessions,
    () => recallRunSession(workspaceId),
    () => null,
  );
}

const CARD = 'rounded-sm border border-border bg-card px-3 py-2 flex flex-col gap-1.5 min-w-0';
const LABEL = 'text-[10px] font-medium uppercase tracking-widest text-muted-foreground';
const ACTION = 'text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50';
const PRIMARY_ACTION = 'text-[11px] text-primary hover:text-primary/80 disabled:opacity-50';

function errorTextFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return fallback;
}

export function WorkspaceActionBand({
  workspaceId,
  kind,
  issueId,
  isGitRepository,
  runCommand,
  runCommandDefault,
  runCommandOptions,
  openInEditorConfigured,
  runSessionName,
  onRunSessionChange,
}: WorkspaceActionBandProps) {
  const queryClient = useQueryClient();
  // Only the first read and explicit refreshes ask the server to hit the
  // network; the poll re-reads whatever the last fetch left behind.
  const forceFetchRef = useRef(true);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [editingCommand, setEditingCommand] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);

  const { data: git } = useQuery({
    queryKey: ['workspace-registry', workspaceId, 'git'],
    queryFn: async (): Promise<WorkspaceGitState | null> => {
      const force = forceFetchRef.current;
      forceFetchRef.current = false;
      const res = await fetch(`/api/workspace-registry/${workspaceId}/git?fetch=${force ? '1' : '0'}`);
      if (!res.ok) return null;
      const body = await res.json() as { git: WorkspaceGitState | null };
      return body.git;
    },
    enabled: isGitRepository,
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const invalidateGit = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['workspace-registry', workspaceId, 'git'] });
  }, [queryClient, workspaceId]);

  const refresh = useCallback(() => {
    forceFetchRef.current = true;
    setGitMessage(null);
    invalidateGit();
  }, [invalidateGit]);

  const pull = useMutation({
    mutationFn: async () => {
      const url = kind === 'issue' && issueId
        ? `/api/issues/${issueId}/sync-main`
        : `/api/workspace-registry/${workspaceId}/pull`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(body, `Pull failed (${res.status})`));
      return body as unknown;
    },
    onSuccess: () => {
      setGitMessage(null);
      forceFetchRef.current = true;
      invalidateGit();
    },
    onError: (error: Error) => setGitMessage(error.message),
  });

  const saveRunCommand = useMutation({
    mutationFn: async (command: string | null) => {
      const res = await fetch(`/api/workspace-registry/${workspaceId}/run-command`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(body, `Could not save the run command (${res.status})`));
      return body as unknown;
    },
    onSuccess: () => {
      setRunMessage(null);
      setEditingCommand(null);
      void queryClient.invalidateQueries({ queryKey: ['workspace-registry', workspaceId] });
    },
    onError: (error: Error) => setRunMessage(error.message),
  });

  const postRun = useCallback(async () => {
    const res = await fetch(`/api/workspace-registry/${workspaceId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => ({})) as { sessionName?: string; alreadyRunning?: boolean; error?: string };
    // 409 means a run session is already live — re-focus it instead of
    // stacking a second dev server on the same port.
    if (res.status === 409 && body.sessionName) return body;
    if (!res.ok) throw new Error(errorTextFrom(body, `Run failed (${res.status})`));
    return body;
  }, [workspaceId]);

  const startRun = useMutation({
    mutationFn: postRun,
    onSuccess: (body) => {
      setRunMessage(body.alreadyRunning ? 'Already running — showing the live session.' : null);
      if (body.sessionName) onRunSessionChange(body.sessionName);
    },
    onError: (error: Error) => setRunMessage(error.message),
  });

  /**
   * A real restart, not a re-focus. The run session name is derived from the
   * workspace id, so a plain Run against a live session only ever comes back
   * 409 — the process would never be replaced. Kill first, drop the session so
   * the terminal unmounts rather than staying attached to a dead pane, then
   * start the fresh one under the same name.
   */
  const restartRun = useMutation({
    mutationFn: async (sessionName: string) => {
      const killed = await fetch(`/api/terminals/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      if (!killed.ok) throw new Error(`Could not stop the run session (${killed.status})`);
      onRunSessionChange(null);
      const body = await postRun();
      if (body.alreadyRunning) throw new Error('The previous run session is still shutting down — try again.');
      return body;
    },
    onSuccess: (body) => {
      setRunMessage(null);
      if (body.sessionName) onRunSessionChange(body.sessionName);
    },
    onError: (error: Error) => setRunMessage(error.message),
  });

  const stopRun = useMutation({
    mutationFn: async (sessionName: string) => {
      const res = await fetch(`/api/terminals/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Could not stop the run session (${res.status})`);
    },
    onSuccess: () => {
      setRunMessage(null);
      onRunSessionChange(null);
    },
    onError: (error: Error) => setRunMessage(error.message),
  });

  const openIn = useMutation({
    mutationFn: async (target: 'file-manager' | 'editor') => {
      const res = await fetch(`/api/workspace-registry/${workspaceId}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(body, `Could not open (${res.status})`));
    },
    onSuccess: () => setOpenMessage(null),
    onError: (error: Error) => setOpenMessage(error.message),
  });

  const effectiveCommand = runCommand ?? runCommandDefault;

  return (
    <div
      className="flex items-start gap-3 px-4 py-2 border-b border-border shrink-0 overflow-x-auto"
      data-testid="workspace-action-band"
    >
      {isGitRepository && (
        <section className={`${CARD} flex-1 max-w-md`} data-testid="workspace-band-git">
          <div className="flex items-center gap-2 min-w-0">
            <span className={LABEL}>Git</span>
            {git?.detached ? (
              <span
                className="rounded-sm border border-warning/32 bg-warning/8 px-1.5 text-[10px] font-medium text-warning-foreground"
                data-testid="workspace-band-git-detached"
              >
                detached HEAD
              </span>
            ) : (
              <span className="font-mono text-xs text-foreground truncate" data-testid="workspace-band-git-branch">
                {git?.branch ?? '—'}
              </span>
            )}
          </div>

          {/* whitespace-nowrap so a narrow band wraps between the counts rather
              than mid-phrase ("↑1 / ahead"). */}
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground min-w-0">
            {git && (
              <>
                <span className="whitespace-nowrap" data-testid="workspace-band-git-counts">
                  {git.behind > 0 && (
                    <span className="text-warning-foreground" data-testid="workspace-band-git-behind">
                      ↓{git.behind} behind
                    </span>
                  )}
                  {git.behind > 0 && git.ahead > 0 && ' · '}
                  {git.ahead > 0 && <span data-testid="workspace-band-git-ahead">↑{git.ahead} ahead</span>}
                  {git.behind === 0 && git.ahead === 0 && <span data-testid="workspace-band-git-even">up to date</span>}
                </span>
                <span className="whitespace-nowrap" data-testid="workspace-band-git-dirty">
                  {git.dirtyFiles === 0 ? 'clean' : `${git.dirtyFiles} uncommitted`}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70 min-w-0">
            {git && (
              <span className="font-mono truncate" data-testid="workspace-band-git-upstream">
                {git.upstreamRef
                  ? git.hasUpstream ? git.upstreamRef : `${git.upstreamRef} (no upstream — comparing default branch)`
                  : 'no remote to compare'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {!git?.detached && (
              <button
                type="button"
                className={PRIMARY_ACTION}
                data-testid="workspace-band-git-pull"
                disabled={pull.isPending}
                onClick={() => pull.mutate()}
              >
                {pull.isPending ? 'Pulling…' : kind === 'issue' ? 'Sync main' : 'Pull'}
              </button>
            )}
            <button type="button" className={ACTION} data-testid="workspace-band-git-refresh" onClick={refresh}>
              Refresh
            </button>
            {(git?.recentRemoteCommits.length ?? 0) > 0 && (
              <button
                type="button"
                className={ACTION}
                data-testid="workspace-band-git-commits-toggle"
                onClick={() => setCommitsOpen((open) => !open)}
              >
                {commitsOpen ? 'Hide incoming' : `Incoming (${git?.recentRemoteCommits.length})`}
              </button>
            )}
          </div>

          {commitsOpen && (
            <ul className="space-y-1 max-h-32 overflow-y-auto" data-testid="workspace-band-git-commits">
              {(git?.recentRemoteCommits ?? []).map((commit) => (
                <li key={commit.sha} className="text-[11px] text-muted-foreground truncate">
                  <span className="font-mono text-muted-foreground/70">{commit.sha.slice(0, 7)}</span>{' '}
                  <span className="text-foreground">{commit.subject}</span>
                </li>
              ))}
            </ul>
          )}

          {gitMessage && (
            <p className="text-[11px] text-destructive" data-testid="workspace-band-git-message">{gitMessage}</p>
          )}
        </section>
      )}

      <section className={`${CARD} flex-1 max-w-md`} data-testid="workspace-band-run">
        <span className={LABEL}>Run</span>
        {editingCommand === null ? (
          <span className="font-mono text-xs text-foreground truncate" data-testid="workspace-band-run-command">
            {effectiveCommand ?? 'no run command configured'}
          </span>
        ) : (
          <input
            type="text"
            className="font-mono text-xs bg-muted border border-border rounded-sm px-1.5 py-1 text-foreground"
            data-testid="workspace-band-run-input"
            value={editingCommand}
            placeholder={runCommandDefault ?? 'npm run dev'}
            onChange={(event) => setEditingCommand(event.target.value)}
          />
        )}

        <div className="flex items-center gap-3">
          {editingCommand === null ? (
            <>
              <button
                type="button"
                className={PRIMARY_ACTION}
                data-testid="workspace-band-run-start"
                disabled={startRun.isPending || restartRun.isPending || !effectiveCommand}
                onClick={() => (runSessionName ? restartRun.mutate(runSessionName) : startRun.mutate())}
              >
                {runSessionName ? (restartRun.isPending ? 'Restarting…' : 'Restart') : 'Run'}
              </button>
              {runSessionName && (
                <button
                  type="button"
                  className={ACTION}
                  data-testid="workspace-band-run-stop"
                  disabled={stopRun.isPending}
                  onClick={() => stopRun.mutate(runSessionName)}
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                className={ACTION}
                data-testid="workspace-band-run-edit"
                onClick={() => setEditingCommand(runCommand ?? runCommandDefault ?? '')}
              >
                Edit
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={PRIMARY_ACTION}
                data-testid="workspace-band-run-save"
                disabled={saveRunCommand.isPending}
                onClick={() => saveRunCommand.mutate(editingCommand.trim() === '' ? null : editingCommand)}
              >
                Save
              </button>
              <button
                type="button"
                className={ACTION}
                data-testid="workspace-band-run-cancel"
                onClick={() => { setEditingCommand(null); setRunMessage(null); }}
              >
                Cancel
              </button>
              {runCommandOptions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className={ACTION}
                  data-testid={`workspace-band-run-option-${option.name}`}
                  onClick={() => setEditingCommand(option.command)}
                >
                  {option.name}
                </button>
              ))}
            </>
          )}
        </div>

        {runMessage && (
          <p className="text-[11px] text-muted-foreground" data-testid="workspace-band-run-message">{runMessage}</p>
        )}
      </section>

      <section className={CARD} data-testid="workspace-band-open">
        <span className={LABEL}>Open</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={ACTION}
            data-testid="workspace-band-open-file-manager"
            disabled={openIn.isPending}
            onClick={() => openIn.mutate('file-manager')}
          >
            Files
          </button>
          {openInEditorConfigured && (
            <button
              type="button"
              className={ACTION}
              data-testid="workspace-band-open-editor"
              disabled={openIn.isPending}
              onClick={() => openIn.mutate('editor')}
            >
              Editor
            </button>
          )}
        </div>
        {openMessage && (
          <p className="text-[11px] text-destructive" data-testid="workspace-band-open-message">{openMessage}</p>
        )}
      </section>
    </div>
  );
}

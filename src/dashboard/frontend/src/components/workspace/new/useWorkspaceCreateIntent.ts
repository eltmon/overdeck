import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport.js';

/** Milliseconds a field must settle before the intent re-resolves. */
export const RESOLVE_DEBOUNCE_MS = 300;

export type WorkspaceCreateMode = 'shared' | 'isolated';

export interface WorkspaceIntentFinding {
  field: 'name' | 'project' | 'targetPath' | 'parentBranch';
  code: string;
  message: string;
  detail?: string;
}

export interface ResolvedWorkspaceIntent {
  projectId: string | null;
  kind: string;
  name: string;
  path: string | null;
  branchName: string | null;
  parentBranch: string | null;
  parentBranchGuessed: boolean;
  isGitRepository: boolean;
  wouldCreateWorktree: boolean;
  unregisteredTargetPath: boolean;
  findings: WorkspaceIntentFinding[];
}

export interface UseWorkspaceCreateIntentOptions {
  initialProjectKey?: string;
  onCreated?: (workspaceId: string) => void;
}

export function useWorkspaceCreateIntent({
  initialProjectKey = '',
  onCreated,
}: UseWorkspaceCreateIntentOptions = {}) {
  const [name, setNameState] = useState('');
  const [projectKey, setProjectKeyState] = useState(initialProjectKey);
  const [targetPath, setTargetPathState] = useState('');
  const [mode, setModeState] = useState<WorkspaceCreateMode>('shared');
  const [parentBranch, setParentBranchState] = useState('');
  const [intent, setIntent] = useState<ResolvedWorkspaceIntent | null>(null);
  const [stale, setStale] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveSeq = useRef(0);

  const invalidateIntent = useCallback(() => {
    resolveSeq.current += 1;
    setIntent(null);
    setStale(true);
    setError(null);
  }, []);

  const setName = useCallback((value: string) => {
    invalidateIntent();
    setNameState(value);
  }, [invalidateIntent]);

  const setProjectKey = useCallback((value: string) => {
    invalidateIntent();
    setProjectKeyState(value);
  }, [invalidateIntent]);

  const setTargetPath = useCallback((value: string) => {
    invalidateIntent();
    setTargetPathState(value);
  }, [invalidateIntent]);

  const setMode = useCallback((value: WorkspaceCreateMode) => {
    invalidateIntent();
    setModeState(value);
  }, [invalidateIntent]);

  const setParentBranch = useCallback((value: string) => {
    invalidateIntent();
    setParentBranchState(value);
  }, [invalidateIntent]);

  const effectiveTargetPath = mode === 'isolated' ? '' : targetPath;

  const requestBody = useMemo(() => ({
    project: projectKey,
    name,
    isolated: mode === 'isolated',
    ...(effectiveTargetPath ? { targetPath: effectiveTargetPath } : {}),
    ...(parentBranch ? { parentBranch } : {}),
  }), [effectiveTargetPath, mode, name, parentBranch, projectKey]);

  useEffect(() => {
    const seq = ++resolveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetchWithTimeout('/api/workspace-registry/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify(requestBody),
          });
          if (!response.ok) {
            if (seq === resolveSeq.current) {
              setError(`Could not resolve the workspace intent (HTTP ${response.status}).`);
            }
            return;
          }

          const resolved = (await response.json()) as ResolvedWorkspaceIntent;
          if (seq !== resolveSeq.current) return;
          setIntent(resolved);
          setStale(false);
        } catch {
          if (seq === resolveSeq.current) {
            setError('Could not reach the server to resolve the workspace intent.');
          }
        }
      })();
    }, RESOLVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [requestBody]);

  const findingsFor = useCallback(
    (field: WorkspaceIntentFinding['field']) => (intent?.findings ?? []).filter((finding) => finding.field === field),
    [intent],
  );

  const hasFindings = (intent?.findings.length ?? 0) > 0;
  const canCreate = !creating && !stale && Boolean(intent) && !hasFindings;

  const submitIntent = useCallback(async (
    body: Record<string, unknown> = requestBody,
  ): Promise<string | null> => {
    setError(null);
    setCreating(true);
    try {
      const response = await fetchWithTimeout('/api/workspace-registry', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          findings?: WorkspaceIntentFinding[];
          error?: string;
        };
        if (json.findings?.length) {
          setIntent((previous) => previous ? { ...previous, findings: json.findings ?? [] } : previous);
          setError(json.findings[0]?.message ?? 'The workspace intent was rejected.');
        } else {
          setError(json.error ?? `HTTP ${response.status}`);
        }
        return null;
      }

      const created = (await response.json()) as { id: string };
      onCreated?.(created.id);
      return created.id;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setCreating(false);
    }
  }, [onCreated, requestBody]);

  return {
    name,
    setName,
    projectKey,
    setProjectKey,
    targetPath,
    setTargetPath,
    mode,
    setMode,
    parentBranch,
    setParentBranch,
    effectiveTargetPath,
    intent,
    stale,
    creating,
    error,
    findingsFor,
    hasFindings,
    canCreate,
    submitIntent,
  };
}

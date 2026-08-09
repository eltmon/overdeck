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
  const [name, setName] = useState('');
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [targetPath, setTargetPath] = useState('');
  const [mode, setMode] = useState<WorkspaceCreateMode>('shared');
  const [parentBranch, setParentBranch] = useState('');
  const [intent, setIntent] = useState<ResolvedWorkspaceIntent | null>(null);
  const [stale, setStale] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveSeq = useRef(0);
  const submitSeq = useRef(0);

  useEffect(() => () => {
    submitSeq.current += 1;
  }, []);

  const effectiveTargetPath = mode === 'isolated' ? '' : targetPath;

  const requestBody = useMemo(() => ({
    project: projectKey,
    name,
    isolated: mode === 'isolated',
    ...(effectiveTargetPath ? { targetPath: effectiveTargetPath } : {}),
    ...(parentBranch ? { parentBranch } : {}),
  }), [effectiveTargetPath, mode, name, parentBranch, projectKey]);

  useEffect(() => {
    setIntent(null);
    setStale(true);
    setError(null);
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
    const seq = ++submitSeq.current;
    try {
      const response = await fetchWithTimeout('/api/workspace-registry', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify(body),
      });
      if (seq !== submitSeq.current) return null;
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          findings?: WorkspaceIntentFinding[];
          error?: string;
        };
        if (seq !== submitSeq.current) return null;
        if (json.findings?.length) {
          setIntent((previous) => previous ? { ...previous, findings: json.findings ?? [] } : previous);
          setError(json.findings[0]?.message ?? 'The workspace intent was rejected.');
        } else {
          setError(json.error ?? `HTTP ${response.status}`);
        }
        return null;
      }

      const created = (await response.json()) as { id: string };
      if (seq !== submitSeq.current) return null;
      onCreated?.(created.id);
      return created.id;
    } catch (cause) {
      if (seq === submitSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return null;
    } finally {
      if (seq === submitSeq.current) setCreating(false);
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

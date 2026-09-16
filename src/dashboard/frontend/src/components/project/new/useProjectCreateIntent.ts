import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport.js';

/** Milliseconds a field must settle before the intent re-resolves. */
export const RESOLVE_DEBOUNCE_MS = 300;

export type ProjectCreateMode = 'clone' | 'existing' | 'new';

export interface ProjectIntentFinding {
  field: 'url' | 'path' | 'parentDir' | 'name' | 'issuePrefix';
  code: string;
  message: string;
  detail?: string;
}

export interface ResolvedProjectIntent {
  mode: ProjectCreateMode;
  key: string | null;
  name: string;
  path: string | null;
  cloneUrl: string | null;
  provider: 'github' | 'gitlab' | null;
  repoSlug: string | null;
  defaultBranch: string | null;
  remoteChecked: boolean;
  isGitRepository: boolean;
  proposedIssuePrefix: string | null;
  wouldClone: boolean;
  wouldGitInit: boolean;
  willCreateMainWorkspace: boolean;
  findings: ProjectIntentFinding[];
}

export interface CreatedProject {
  key: string;
  name: string;
  path: string;
  mainWorkspaceId?: string;
}

export interface UseProjectCreateIntentOptions {
  onCreated?: (project: CreatedProject) => void;
}

export function useProjectCreateIntent({
  onCreated,
}: UseProjectCreateIntentOptions = {}) {
  const [mode, setMode] = useState<ProjectCreateMode>('clone');
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [name, setName] = useState('');
  const [issuePrefix, setIssuePrefix] = useState('');
  const [intent, setIntent] = useState<ResolvedProjectIntent | null>(null);
  const [stale, setStale] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; percent: number | null } | null>(null);
  const resolveSeq = useRef(0);
  const submitSeq = useRef(0);
  const pollTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    submitSeq.current += 1;
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
  }, []);

  const requestBody = useMemo(() => ({
    mode,
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(parentDir ? { parentDir } : {}),
    ...(name ? { name } : {}),
    ...(issuePrefix ? { issuePrefix } : {}),
  }), [issuePrefix, mode, name, parentDir, path, url]);

  useEffect(() => {
    setIntent(null);
    setStale(true);
    setError(null);
    const seq = ++resolveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetchWithTimeout('/api/projects/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify(requestBody),
          });
          if (!response.ok) {
            if (seq === resolveSeq.current) {
              setError(`Could not resolve the project intent (HTTP ${response.status}).`);
            }
            return;
          }

          const resolved = (await response.json()) as ResolvedProjectIntent;
          if (seq !== resolveSeq.current) return;
          setIntent(resolved);
          setStale(false);
        } catch {
          if (seq === resolveSeq.current) {
            setError('Could not reach the server to resolve the project intent.');
          }
        }
      })();
    }, RESOLVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [requestBody]);

  const findingsFor = useCallback(
    (field: ProjectIntentFinding['field']) => (intent?.findings ?? []).filter((finding) => finding.field === field),
    [intent],
  );

  const hasFindings = (intent?.findings.length ?? 0) > 0;
  const canCreate = !creating && !stale && Boolean(intent) && !hasFindings;

  const pollJob = useCallback(async (jobId: string, seq: number) => {
    try {
      const response = await fetchWithTimeout(`/api/projects/create-jobs/${jobId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Server restarted; check if project was created
          const projectsResponse = await fetchWithTimeout('/api/registered-projects', {
            credentials: 'include',
          });
          if (projectsResponse.ok) {
            const projects = (await projectsResponse.json()) as Array<{
              key: string;
              name: string;
              path: string;
              mainWorkspaceId?: string;
            }>;
            const created = projects.find((p) => p.key === intent?.key);
            if (created) {
              if (seq === submitSeq.current) {
                onCreated?.(created);
              }
              return;
            }
          }
          if (seq === submitSeq.current) {
            setError('Clone was interrupted; check the target path and retry.');
          }
        } else if (seq === submitSeq.current) {
          setError(`Job check failed (HTTP ${response.status}).`);
        }
        return;
      }

      const job = (await response.json()) as {
        status: string;
        phase?: string;
        percent?: number | null;
        result?: CreatedProject;
        error?: string;
      };

      if (seq !== submitSeq.current) return;

      if (job.status === 'running') {
        setProgress({ phase: job.phase ?? 'cloning', percent: job.percent ?? null });
        pollTimeoutRef.current = window.setTimeout(() => {
          void pollJob(jobId, seq);
        }, 750);
      } else if (job.status === 'done' && job.result) {
        setProgress(null);
        onCreated?.(job.result);
      } else if (job.status === 'failed') {
        setError(job.error ?? 'Clone failed for an unknown reason.');
      }
    } catch (cause) {
      if (seq === submitSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, [intent?.key, onCreated]);

  const submit = useCallback(async (
    body: Record<string, unknown> = requestBody,
  ): Promise<CreatedProject | null> => {
    setError(null);
    setCreating(true);
    setProgress(null);
    const seq = ++submitSeq.current;
    try {
      const response = await fetchWithTimeout('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify(body),
      });
      if (seq !== submitSeq.current) return null;

      if (response.status === 422) {
        const json = (await response.json().catch(() => ({}))) as {
          findings?: ProjectIntentFinding[];
        };
        if (seq !== submitSeq.current) return null;
        if (json.findings?.length) {
          setIntent((previous) => previous ? { ...previous, findings: json.findings ?? [] } : previous);
          setError(json.findings[0]?.message ?? 'The project intent was rejected.');
        }
        return null;
      }

      if (response.status === 202) {
        // Clone job created
        const json = (await response.json().catch(() => ({}))) as { jobId?: string };
        if (seq !== submitSeq.current) return null;
        if (json.jobId) {
          setProgress({ phase: 'cloning', percent: null });
          await pollJob(json.jobId, seq);
        }
        return null;
      }

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (seq !== submitSeq.current) return null;
        setError(json.error ?? `HTTP ${response.status}`);
        return null;
      }

      const created = (await response.json()) as CreatedProject;
      if (seq !== submitSeq.current) return null;
      onCreated?.(created);
      return created;
    } catch (cause) {
      if (seq === submitSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return null;
    } finally {
      if (seq === submitSeq.current) setCreating(false);
    }
  }, [requestBody, pollJob, onCreated]);

  return {
    mode,
    setMode,
    url,
    setUrl,
    path,
    setPath,
    parentDir,
    setParentDir,
    name,
    setName,
    issuePrefix,
    setIssuePrefix,
    intent,
    stale,
    creating,
    error,
    progress,
    canCreate,
    findingsFor,
    submit,
  };
}

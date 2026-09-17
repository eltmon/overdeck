/**
 * State for the project-creation form (PAN-3836 WI-4).
 *
 * Three rules shape everything here, and each exists because its absence
 * produced a specific wrong screen:
 *
 *   1. **One operation, one submission.** A synchronous ref guard closes before
 *      any await, so a double click or an Enter-plus-click in the same tick
 *      cannot start two clones. The `operationId` is generated once and reused
 *      across a retry of a lost POST, so the server can attach the retry to the
 *      attempt already running instead of starting another.
 *   2. **A failed poll is not a failed clone.** The old code did
 *      `setCreating(false)` on an HTTP 503, which re-enabled Create while a
 *      clone was still running and left a stale 42% next to an error message.
 *      Losing contact now means `connection-lost`: the operation is still ours,
 *      the outcome is simply unknown, and Create stays disabled until something
 *      terminal is actually observed.
 *   3. **Proposals never overwrite what you typed.** Server-derived values are
 *      shown as real defaults, but an explicit edit is stored separately as an
 *      override, so changing the URL cannot silently rewrite a name you chose.
 *      `undefined` means "not edited"; an empty string is a deliberate clearing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport.js';
import { capture } from '../../../lib/telemetry.js';
import {
  OBSERVATION_STORAGE_KEY,
  type CreatedProject,
  type ProjectCreateFailure,
  type ProjectCreateMode,
  type ProjectCreateObservation,
  type ProjectCreateProgress,
  type ProjectIntentField,
  type ProjectIntentFinding,
  type ProjectSubmissionState,
  type ResolvedProjectIntent,
} from './projectCreateTypes.js';

export * from './projectCreateTypes.js';

/** Milliseconds a field must settle before the intent re-resolves. */
export const RESOLVE_DEBOUNCE_MS = 300;
/** Delay between polls while an operation is healthy. */
export const POLL_INTERVAL_MS = 750;
/**
 * Backoff after a lost poll. Five attempts, then the operator takes over with
 * "Check again" — an unbounded retry would look identical to a hung clone.
 */
export const POLL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 8_000] as const;

export interface UseProjectCreateIntentOptions {
  onCreated?: (project: CreatedProject) => void;
  initialMode?: ProjectCreateMode;
}

function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** sessionStorage is a convenience, never canonical — every access can throw. */
function readObservation(): ProjectCreateObservation | null {
  try {
    const raw = sessionStorage.getItem(OBSERVATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProjectCreateObservation;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeObservation(observation: ProjectCreateObservation | null): void {
  try {
    if (observation) sessionStorage.setItem(OBSERVATION_STORAGE_KEY, JSON.stringify(observation));
    else sessionStorage.removeItem(OBSERVATION_STORAGE_KEY);
  } catch {
    // Private windows and blocked site data: the page still works, it just
    // cannot resume observation across a reload.
  }
}

function failureFrom(body: unknown, fallback: string): ProjectCreateFailure {
  const asRecord = body as { failure?: ProjectCreateFailure; error?: string } | null;
  if (asRecord?.failure?.code) return asRecord.failure;
  return {
    code: 'internal-error',
    message: asRecord?.error ?? fallback,
    retrySafe: true,
  };
}

export function useProjectCreateIntent({
  onCreated,
  initialMode = 'clone',
}: UseProjectCreateIntentOptions = {}) {
  const [mode, setModeState] = useState<ProjectCreateMode>(initialMode);
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');

  // Overrides are `undefined` until edited, which is what keeps a server
  // proposal from being mistaken for a user's choice (D-17).
  const [parentOverride, setParentOverride] = useState<string | undefined>(undefined);
  const [nameOverride, setNameOverride] = useState<string | undefined>(undefined);
  const [prefixOverride, setPrefixOverride] = useState<string | undefined>(undefined);

  const [intent, setIntent] = useState<ResolvedProjectIntent | null>(null);
  const [checking, setChecking] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<ProjectSubmissionState>({ kind: 'editing' });

  const resolveSeq = useRef(0);
  const generation = useRef(0);
  /** Closes before any await, unlike React state. */
  const submitLock = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const retryIndex = useRef(0);
  const createdFired = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const frozen =
    submission.kind === 'submitting' ||
    submission.kind === 'running' ||
    submission.kind === 'cancelling' ||
    submission.kind === 'connection-lost';

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      clearPoll();
      abortRef.current?.abort();
    },
    [clearPoll],
  );

  // ─── Effective values ──────────────────────────────────────────────────────
  // Proposal unless edited. The effective value is what renders *and* what is
  // submitted; sending an empty override instead would suppress derivation.
  const effectiveParentDir = parentOverride ?? intent?.parentDir ?? '';
  const effectiveName = nameOverride ?? intent?.name ?? '';
  const effectivePrefix = prefixOverride ?? intent?.proposedIssuePrefix ?? '';

  const requestBody = useMemo(
    () => ({
      mode,
      ...(mode === 'clone' && url ? { url } : {}),
      ...(mode === 'existing' && path ? { path } : {}),
      ...(parentOverride ? { parentDir: parentOverride } : {}),
      ...(nameOverride ? { name: nameOverride } : {}),
      ...(prefixOverride ? { issuePrefix: prefixOverride } : {}),
    }),
    [mode, url, path, parentOverride, nameOverride, prefixOverride],
  );

  // ─── Resolve ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (frozen) return undefined; // inputs are locked; nothing can have changed
    const seq = ++resolveSeq.current;
    setChecking(true);
    setResolveError(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetchWithTimeout('/api/projects/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify(requestBody),
          });
          if (seq !== resolveSeq.current) return; // a newer edit already won
          if (!response.ok) {
            setChecking(false);
            setResolveError('Could not check this with the server. Try again.');
            return;
          }
          setIntent((await response.json()) as ResolvedProjectIntent);
          setChecking(false);
        } catch {
          if (seq !== resolveSeq.current) return;
          setChecking(false);
          setResolveError('Could not reach the server. Check your connection, then try again.');
        }
      })();
    }, RESOLVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [requestBody, frozen]);

  const findingsFor = useCallback(
    (field: ProjectIntentField): ProjectIntentFinding[] =>
      (intent?.findings ?? []).filter((finding) => finding.field === field),
    [intent],
  );

  const setMode = useCallback(
    (next: ProjectCreateMode) => {
      if (frozen) return; // D-19: no mode changes while an operation is live
      setModeState(next);
      // Only the source fields are mode-specific; a clone URL must never ride
      // along into a `new` request. Name and prefix overrides are visible in
      // Options, so they deliberately survive.
      setUrl('');
      setPath('');
      setIntent(null);
    },
    [frozen],
  );

  const resetOverrides = useCallback(() => {
    setNameOverride(undefined);
    setPrefixOverride(undefined);
    setParentOverride(undefined);
  }, []);

  const finish = useCallback(
    (operationId: string, result: CreatedProject) => {
      writeObservation(null);
      setSubmission({ kind: 'done', result });
      // Exactly once per operation, even if a poll and a reconcile both land.
      if (createdFired.current === operationId) return;
      createdFired.current = operationId;
      capture('project_created', { mode });
      onCreated?.(result);
    },
    [mode, onCreated],
  );

  // ─── Polling ───────────────────────────────────────────────────────────────
  const scheduleNextPoll = useCallback((run: () => void, delay: number) => {
    clearPoll();
    pollTimer.current = window.setTimeout(run, delay);
  }, [clearPoll]);

  // `reconcile` can hand control back to the poller, and the poller calls
  // `reconcile` on a 404. A ref breaks that declaration cycle without making
  // either callback depend on the other's identity — which would rebuild both
  // on every render and restart the poll.
  const pollJobRef = useRef<((o: ProjectCreateObservation, g: number) => void) | null>(null);

  const reconcile = useCallback(
    async (observation: ProjectCreateObservation, gen: number): Promise<void> => {
      try {
        const response = await fetchWithTimeout('/api/projects/create-jobs/reconcile', {
          method: 'POST',
          credentials: 'include',
          headers: await dashboardMutationJsonHeaders(),
          body: JSON.stringify({
            operationId: observation.operationId,
            jobId: observation.jobId,
            key: observation.expectedKey,
            expectedPath: observation.expectedPath,
            mode: observation.mode,
            expectedRepoSlug: observation.expectedRepoSlug ?? null,
          }),
        });
        if (gen !== generation.current) return;
        if (!response.ok) {
          setSubmission({
            kind: 'connection-lost',
            operationId: observation.operationId,
            jobId: observation.jobId,
            exhausted: true,
          });
          return;
        }
        const body = (await response.json()) as
          | { status: 'completed'; key: string; name?: string; path: string; mainWorkspaceId?: string }
          | { status: 'needs-setup'; key: string; path: string; reason: string }
          | { status: 'conflict'; reason: string }
          | { status: 'unknown'; reason: string }
          | { status: 'job'; job: { id: string; phase: string; percent: number | null } };
        if (gen !== generation.current) return;

        if (body.status === 'completed') {
          finish(observation.operationId, {
            key: body.key,
            name: body.name ?? body.key,
            path: body.path,
            mainWorkspaceId: body.mainWorkspaceId,
          });
          return;
        }
        if (body.status === 'needs-setup') {
          setSubmission({
            kind: 'needs-setup',
            operationId: observation.operationId,
            key: body.key,
            path: body.path,
            failure: {
              code: 'setup-incomplete',
              message: `The repository is available at ${body.path}, but project setup did not finish.`,
              retrySafe: false,
              recovery: { action: 'finish-setup', key: body.key, path: body.path },
            },
          });
          return;
        }
        if (body.status === 'job') {
          // The server still owns this clone. Nothing is lost — pick the poll
          // back up rather than stranding the operator on a dead-end screen.
          const withJob = { ...observation, jobId: body.job.id };
          writeObservation(withJob);
          setSubmission({
            kind: 'running',
            operationId: observation.operationId,
            jobId: body.job.id,
            progress: { phase: body.job.phase, percent: body.job.percent },
          });
          retryIndex.current = 0;
          pollJobRef.current?.(withJob, gen);
          return;
        }
        // conflict / unknown: nothing is proved, so the operator reviews rather
        // than the page retrying into a live clone.
        setSubmission({
          kind: 'connection-lost',
          operationId: observation.operationId,
          jobId: observation.jobId,
          exhausted: true,
        });
      } catch {
        if (gen !== generation.current) return;
        setSubmission({
          kind: 'connection-lost',
          operationId: observation.operationId,
          jobId: observation.jobId,
          exhausted: true,
        });
      }
    },
    [finish],
  );

  const pollJob = useCallback(
    async (observation: ProjectCreateObservation, gen: number): Promise<void> => {
      const jobId = observation.jobId;
      if (!jobId) return;
      try {
        const response = await fetchWithTimeout(`/api/projects/create-jobs/${jobId}`, {
          credentials: 'include',
        });
        if (gen !== generation.current) return;

        if (response.status === 404) {
          // Unknown to this runtime — not proof of failure. Reconcile once.
          await reconcile(observation, gen);
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setSubmission({
            kind: 'connection-lost',
            operationId: observation.operationId,
            jobId,
            exhausted: true,
          });
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        retryIndex.current = 0; // a good poll restores the budget
        const job = (await response.json()) as {
          status: string;
          phase: string;
          percent: number | null;
          result?: CreatedProject;
          failure?: ProjectCreateFailure;
          error?: string;
        };
        if (gen !== generation.current) return;

        if (job.status === 'done' && job.result) {
          finish(observation.operationId, job.result);
          return;
        }
        if (job.status === 'cancelled') {
          writeObservation(null);
          setSubmission({ kind: 'cancelled' });
          return;
        }
        if (job.status === 'failed') {
          const failure = failureFrom(job, 'Project setup failed on the server.');
          writeObservation(null);
          setSubmission(
            failure.code === 'setup-incomplete' && failure.recovery?.action === 'finish-setup'
              ? {
                  kind: 'needs-setup',
                  operationId: observation.operationId,
                  key: failure.recovery.key,
                  path: failure.recovery.path,
                  failure,
                }
              : { kind: 'failed', failure, retrySafe: failure.retrySafe },
          );
          return;
        }

        const progress: ProjectCreateProgress = { phase: job.phase, percent: job.percent };
        setSubmission((current) =>
          current.kind === 'cancelling'
            ? current
            : { kind: 'running', operationId: observation.operationId, jobId, progress },
        );
        scheduleNextPoll(() => void pollJob(observation, gen), POLL_INTERVAL_MS);
      } catch {
        if (gen !== generation.current) return;
        const attempt = retryIndex.current;
        if (attempt >= POLL_RETRY_DELAYS_MS.length) {
          // Budget spent. Keep the operation and hand the decision over rather
          // than silently re-enabling Create.
          setSubmission((current) => ({
            kind: 'connection-lost',
            operationId: observation.operationId,
            jobId,
            lastProgress: current.kind === 'running' ? current.progress : undefined,
            exhausted: true,
          }));
          return;
        }
        retryIndex.current = attempt + 1;
        setSubmission((current) => ({
          kind: 'connection-lost',
          operationId: observation.operationId,
          jobId,
          lastProgress:
            current.kind === 'running'
              ? current.progress
              : current.kind === 'connection-lost'
                ? current.lastProgress
                : undefined,
          exhausted: false,
        }));
        scheduleNextPoll(() => void pollJob(observation, gen), POLL_RETRY_DELAYS_MS[attempt]);
      }
    },
    [finish, reconcile, scheduleNextPoll],
  );
  pollJobRef.current = (o, g) => void pollJob(o, g);

  // ─── Resume observation after a reload ─────────────────────────────────────
  useEffect(() => {
    const observation = readObservation();
    if (!observation) return;
    operationIdRef.current = observation.operationId;
    submitLock.current = true;
    setSubmission({
      kind: 'connection-lost',
      operationId: observation.operationId,
      jobId: observation.jobId,
      exhausted: false,
    });
    void (observation.jobId
      ? pollJob(observation, generation.current)
      : reconcile(observation, generation.current));
    // Intentionally once, on mount: resuming a stored operation is a page-load
    // concern, and re-running it on every dependency change would re-poll.
  }, []); // eslint-disable-line

  const hasFindings = (intent?.findings.length ?? 0) > 0;
  const canCreate =
    submission.kind === 'editing' && !checking && Boolean(intent) && !hasFindings && !resolveError;

  const submit = useCallback(async (): Promise<void> => {
    // Synchronous, before any await: React state would not have re-rendered yet.
    if (submitLock.current || !canCreate || !intent) return;
    submitLock.current = true;

    const operationId = operationIdRef.current ?? newOperationId();
    operationIdRef.current = operationId;
    const gen = generation.current;
    setSubmission({ kind: 'submitting', operationId });

    const observation: ProjectCreateObservation = {
      version: 1,
      operationId,
      mode,
      expectedKey: intent.key ?? '',
      expectedPath: intent.path ?? '',
      expectedRepoSlug: intent.repoSlug,
    };

    try {
      const response = await fetchWithTimeout('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ ...requestBody, operationId }),
      });
      if (gen !== generation.current) return;

      if (response.status === 202) {
        const { jobId } = (await response.json()) as { jobId?: string };
        if (!jobId) {
          // A 202 with no job id means the server joined this submission to one
          // already in flight that has not started a job yet. Something is
          // running, so this is unknown — never an invitation to submit again.
          // Store the observation first, or Check again has nothing to read.
          writeObservation(observation);
          setSubmission({ kind: 'connection-lost', operationId, exhausted: true });
          return;
        }
        const withJob = { ...observation, jobId };
        writeObservation(withJob);
        setSubmission({
          kind: 'running',
          operationId,
          jobId,
          progress: { phase: 'preparing', percent: null },
        });
        retryIndex.current = 0;
        void pollJob(withJob, gen);
        return;
      }

      if (response.ok) {
        finish(operationId, (await response.json()) as CreatedProject);
        return;
      }

      if (response.status === 422) {
        const { findings } = (await response.json()) as { findings?: ProjectIntentFinding[] };
        setIntent((current) => (current ? { ...current, findings: findings ?? [] } : current));
        submitLock.current = false;
        operationIdRef.current = null;
        setSubmission({ kind: 'editing' });
        return;
      }

      const failure = failureFrom(await response.json().catch(() => null), 'Project setup failed.');
      setSubmission(
        failure.recovery?.action === 'finish-setup'
          ? {
              kind: 'needs-setup',
              operationId,
              key: failure.recovery.key,
              path: failure.recovery.path,
              failure,
            }
          : { kind: 'failed', failure, retrySafe: failure.retrySafe },
      );
      // Only a retry-safe failure releases the lock for a fresh attempt.
      if (failure.retrySafe) {
        submitLock.current = false;
        operationIdRef.current = null;
      }
    } catch {
      if (gen !== generation.current) return;
      // The POST may well have been accepted; its response was lost. Keep the
      // operation id so a retry attaches instead of starting a second clone.
      writeObservation(observation);
      setSubmission({ kind: 'connection-lost', operationId, exhausted: false });
      void reconcile(observation, gen);
    }
  }, [canCreate, intent, mode, requestBody, finish, pollJob, reconcile]);

  const cancel = useCallback(async (): Promise<void> => {
    if (submission.kind !== 'running') return;
    const { operationId, jobId } = submission;
    setSubmission({ kind: 'cancelling', operationId, jobId });
    try {
      const response = await fetchWithTimeout(`/api/projects/create-jobs/${jobId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: '{}',
      });
      if (response.status === 409) {
        // Setup already began; keep observing rather than claiming a cancel.
        setSubmission({
          kind: 'running',
          operationId,
          jobId,
          progress: { phase: 'registering', percent: null },
        });
      }
    } catch {
      // The request itself failed; the job may still be running either way.
      setSubmission({ kind: 'connection-lost', operationId, jobId, exhausted: true });
    }
  }, [submission]);

  const checkAgain = useCallback((): void => {
    if (submission.kind !== 'connection-lost') return;
    const observation = readObservation();
    if (!observation) return;
    retryIndex.current = 0;
    setSubmission({ ...submission, exhausted: false });
    void (observation.jobId
      ? pollJob(observation, generation.current)
      : reconcile(observation, generation.current));
  }, [submission, pollJob, reconcile]);

  const finishSetup = useCallback(async (): Promise<void> => {
    if (submission.kind !== 'needs-setup') return;
    const { key, path: expectedPath, operationId } = submission;
    try {
      const response = await fetchWithTimeout(`/api/projects/${encodeURIComponent(key)}/finish-setup`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ expectedPath, operationId }),
      });
      if (response.ok) {
        finish(operationId, (await response.json()) as CreatedProject);
        return;
      }
      setSubmission({
        ...submission,
        failure: failureFrom(await response.json().catch(() => null), 'Setup could not be finished.'),
      });
    } catch {
      setSubmission({ kind: 'connection-lost', operationId, exhausted: true });
    }
  }, [submission, finish]);

  /** Start over after a terminal failure, preserving every typed field. */
  const dismissFailure = useCallback((): void => {
    submitLock.current = false;
    operationIdRef.current = null;
    writeObservation(null);
    setSubmission({ kind: 'editing' });
  }, []);

  return {
    mode,
    setMode,
    url,
    setUrl,
    path,
    setPath,
    parentDir: effectiveParentDir,
    setParentDir: setParentOverride,
    name: effectiveName,
    setName: setNameOverride,
    issuePrefix: effectivePrefix,
    setIssuePrefix: setPrefixOverride,
    hasOverrides: nameOverride !== undefined || prefixOverride !== undefined || parentOverride !== undefined,
    resetOverrides,
    intent,
    checking,
    resolveError,
    submission,
    frozen,
    canCreate,
    findingsFor,
    submit,
    cancel,
    checkAgain,
    finishSetup,
    dismissFailure,
  };
}

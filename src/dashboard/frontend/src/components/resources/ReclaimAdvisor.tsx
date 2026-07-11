import { useState } from 'react';
import type { ReclaimCandidate } from '../../types';

interface ReclaimAdvisorProps {
  candidates?: ReclaimCandidate[];
  totals?: { ramBytes: number; diskBytes: number };
  thresholdBytes?: number;
}

type RowState = 'pending' | 'running' | 'done' | 'error';

interface StackTeardownEstimate {
  issueId: string;
  composeProject: string;
  confirmToken: string;
}

export function ReclaimAdvisor({ candidates = [], totals, thresholdBytes = 0 }: ReclaimAdvisorProps) {
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const totalBytes = (totals?.ramBytes ?? 0) + (totals?.diskBytes ?? 0);
  if (candidates.length === 0 || totalBytes < thresholdBytes) return null;

  async function runCandidate(candidate: ReclaimCandidate) {
    const { method, path } = parseAction(candidate.action);
    if (candidate.kind === 'stack') {
      const estimateResponse = await fetch(path, { method });
      if (!estimateResponse.ok) throw new Error(await estimateResponse.text() || `Request failed with ${estimateResponse.status}`);
      const estimate = await estimateResponse.json() as StackTeardownEstimate;
      const teardownPath = path.replace(/\/teardown-estimate$/, '/teardown');
      const teardownResponse = await fetch(teardownPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmToken: estimate.confirmToken,
          typedText: estimate.composeProject,
        }),
      });
      if (!teardownResponse.ok) throw new Error(await teardownResponse.text() || `Request failed with ${teardownResponse.status}`);
      return;
    }

    const response = await fetch(path, { method });
    if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
  }

  async function runAll() {
    if (!window.confirm('Reclaim all safe resources?')) return;
    setRowErrors({});
    for (let index = 0; index < candidates.length; index += 1) {
      const ok = await runCandidateAt(index);
      if (!ok) return;
    }
  }

  async function runCandidateAt(index: number) {
    const candidate = candidates[index];
    if (!candidate) return false;
    setRowErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setRowStates((current) => ({ ...current, [index]: 'running' }));
    try {
      await runCandidate(candidate);
      setRowStates((current) => ({ ...current, [index]: 'done' }));
      return true;
    } catch (error) {
      setRowStates((current) => ({ ...current, [index]: 'error' }));
      setRowErrors((current) => ({ ...current, [index]: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  return (
    <section className="mb-6 border border-border bg-background" aria-label="Reclaim advisor">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-foreground">Reclaim advisor</h2>
          <p className="text-sm text-muted-foreground">
            {formatBytes(totals?.ramBytes ?? 0)} RAM · {formatBytes(totals?.diskBytes ?? 0)} disk safe to free
          </p>
        </div>
        <button type="button" className="border border-primary px-3 py-2 font-['DM_Mono'] text-xs uppercase text-primary" onClick={runAll}>
          Reclaim all safe
        </button>
      </div>
      <div className="divide-y divide-border">
        {candidates.map((candidate, index) => {
          const state = rowStates[index] ?? 'pending';
          return (
            <div key={`${candidate.kind}:${candidate.label}:${index}`} className="grid grid-cols-[1fr_160px_120px] items-center gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{candidate.label}</div>
                <div className="text-xs text-muted-foreground">{candidate.why}</div>
                {rowErrors[index] && <div className="mt-1 text-xs text-destructive">{rowErrors[index]}</div>}
              </div>
              <div className="font-['DM_Mono'] text-xs text-muted-foreground">
                {formatBytes(candidate.ramBytes)} RAM · {formatBytes(candidate.diskBytes)} disk
              </div>
              <button
                type="button"
                className="justify-self-end border border-border px-2 py-1 font-['DM_Mono'] text-xs uppercase disabled:cursor-not-allowed disabled:opacity-50"
                disabled={state === 'running' || state === 'done'}
                onClick={() => void runCandidateAt(index)}
              >
                {state === 'pending' ? actionLabel(candidate) : state}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function parseAction(action: string) {
  const [method, path] = action.split(/\s+/, 2);
  return {
    method: method || 'POST',
    path: path || action,
  };
}

function actionLabel(candidate: ReclaimCandidate) {
  if (candidate.kind === 'stack') return 'Stop stack';
  if (candidate.kind === 'venv') return 'Delete venvs';
  if (candidate.kind === 'docker-prune') return 'Prune';
  return 'Remove';
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

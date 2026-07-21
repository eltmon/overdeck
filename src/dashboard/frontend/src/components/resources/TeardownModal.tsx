import { useEffect, useState } from 'react';
import type { ResourceStack } from '../../types';

interface TeardownEstimate {
  issueId: string;
  composeProject: string;
  ramBytes: number;
  diskBytes: number;
  confirmToken: string;
}

interface TeardownModalProps {
  stack: ResourceStack;
  onClose: () => void;
  onComplete?: () => void | Promise<void>;
}

export function TeardownModal({ stack, onClose, onComplete }: TeardownModalProps) {
  const [estimate, setEstimate] = useState<TeardownEstimate | null>(null);
  const [typedText, setTypedText] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issueId = stack.issueId ?? stack.id;
  const canConfirm = Boolean(estimate) && typedText === estimate?.composeProject && !posting;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/resources/stacks/${encodeURIComponent(issueId)}/teardown-estimate`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
        return response.json() as Promise<TeardownEstimate>;
      })
      .then((body) => {
        if (!cancelled) setEstimate(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  async function confirmTeardown() {
    if (!estimate || !canConfirm) return;
    setPosting(true);
    setError(null);
    try {
      const response = await fetch(`/api/resources/stacks/${encodeURIComponent(issueId)}/teardown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmToken: estimate.confirmToken, typedText }),
      });
      if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
      await onComplete?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Tear down stack">
      <div className="w-full max-w-lg border border-border bg-background shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-foreground">Tear down {issueId}</h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Calculating reclaim estimate'
              : estimate
                ? `frees ${formatBytes(estimate.ramBytes)} RAM · ${formatBytes(estimate.diskBytes)} disk`
                : 'Estimate unavailable'}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          {estimate && (
            <>
              <label className="block text-sm text-foreground" htmlFor="teardown-confirm-text">
                Type {estimate.composeProject}
              </label>
              <input
                id="teardown-confirm-text"
                className="w-full border border-border bg-background px-3 py-2 font-['DM_Mono'] text-sm text-foreground"
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
                autoFocus
              />
            </>
          )}
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" className="border border-border px-3 py-2 text-sm text-foreground" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="border border-destructive px-3 py-2 text-sm text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canConfirm}
            onClick={confirmTeardown}
          >
            {posting ? 'Tearing down' : 'Tear down'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

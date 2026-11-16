import { useEffect, useState } from 'react';
import type { ResourceStack } from '../../types';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';

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
    <Modal
      title={`Tear down ${issueId}`}
      ariaLabel="Tear down stack"
      description={
        loading
          ? 'Calculating reclaim estimate'
          : estimate
            ? `frees ${formatBytes(estimate.ramBytes)} RAM · ${formatBytes(estimate.diskBytes)} disk`
            : 'Estimate unavailable'
      }
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={formStyles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={formStyles.destructiveButton}
            disabled={!canConfirm}
            onClick={confirmTeardown}
          >
            {posting ? 'Tearing down' : 'Tear down'}
          </button>
        </>
      }
    >
      <div className={formStyles.form}>
        {estimate && (
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="teardown-confirm-text">
              Type {estimate.composeProject}
            </label>
            <input
              id="teardown-confirm-text"
              className={`${formStyles.input} ${formStyles.mono}`}
              value={typedText}
              onChange={(event) => setTypedText(event.target.value)}
              autoFocus
            />
          </div>
        )}
        {error && <div className={formStyles.error}>{error}</div>}
      </div>
    </Modal>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

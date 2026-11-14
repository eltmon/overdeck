/**
 * Merge train batching (PAN-4753 D4): the two batch window settings,
 * `merge_train.batch_size` and `merge_train.batch_wait_minutes`, written
 * through `POST /api/merge-train/config` like the Flywheel header switches.
 */
import { useEffect, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsRow } from '../primitives';
import { useMergeTrainConfig, useMergeTrainConfigMutation } from '../../merge-train/config';

type BatchKey = 'batch_size' | 'batch_wait_minutes';

const BOUNDS: Record<BatchKey, { min: number; max: number }> = {
  batch_size: { min: 1, max: 20 },
  batch_wait_minutes: { min: 1, max: 1440 },
};

function NumberField({ field, value, disabled, label, testId, onSave }: {
  field: BatchKey;
  value: number | undefined;
  disabled: boolean;
  label: string;
  testId: string;
  onSave: (field: BatchKey, next: number) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => { setDraft(value === undefined ? '' : String(value)); }, [value]);
  const { min, max } = BOUNDS[field];
  const commit = () => {
    const next = Number(draft);
    if (!Number.isInteger(next) || next < min || next > max) {
      toast.error(`${label} must be a whole number from ${min} to ${max}`);
      setDraft(value === undefined ? '' : String(value));
      return;
    }
    if (next !== value) onSave(field, next);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      aria-label={label}
      data-testid={testId}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
    />
  );
}

export function MergeTrainBatchingSection() {
  const { data: config, error } = useMergeTrainConfig();
  const mutation = useMergeTrainConfigMutation();
  const save = (field: BatchKey, next: number) => {
    mutation.mutate({ [field]: next }, {
      onError: (err) => toast.error(`Failed to save merge train batching: ${err instanceof Error ? err.message : String(err)}`),
    });
  };
  const disabled = !config || mutation.isPending;

  return (
    <section id="merge-train-batching" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <GitMerge className="w-4 h-4 text-muted-foreground" />
        Merge Train
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        While the merge train is on (the switch on the Flywheel page), normal-priority PRs wait and merge together as one
        batch once the batch&apos;s CI is green. Strikes and issues labeled critical, blocks-main, or both
        substrate-improvement and bug still merge on their own. With the train off, every ready PR merges on its own.
      </p>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Failed to load merge train settings: {error instanceof Error ? error.message : String(error)}
        </div>
      ) : (
        <div className="space-y-1">
          <SettingsRow
            label="Batch size"
            description="A batch merges as soon as it holds this many ready PRs (1 to 20)."
          >
            <NumberField
              field="batch_size"
              value={config?.batch_size}
              disabled={disabled}
              label="Batch size"
              testId="merge-train-batch-size"
              onSave={save}
            />
          </SettingsRow>
          <SettingsRow
            label="Batch wait (minutes)"
            description="A smaller batch, even a single PR, merges once its oldest PR has waited this long (1 to 1440)."
          >
            <NumberField
              field="batch_wait_minutes"
              value={config?.batch_wait_minutes}
              disabled={disabled}
              label="Batch wait (minutes)"
              testId="merge-train-batch-wait"
              onSave={save}
            />
          </SettingsRow>
        </div>
      )}
    </section>
  );
}

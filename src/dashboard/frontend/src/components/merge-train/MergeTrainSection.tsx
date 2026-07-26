import { MergeTrainView } from './MergeTrainView';
import { useFlywheelConfig, useFlywheelConfigMutation } from '../../pages/FlywheelPage';

/**
 * PAN-1696 fe-awaiting-merge: the merge train hosted on the merge gate.
 *
 * The merge train assembles the features that already passed review and tests
 * into one batch per project, so an operator can test that exact tree once and
 * merge it in a single click instead of merging features one at a time. It runs
 * per project and needs no flywheel run — this section is the multi-project
 * home for it, and the Flywheel page is a second viewer of the same view.
 *
 * The toggle here is the GLOBAL default. `merge_train_enabled` is the retained
 * payload key on /api/flywheel/config; the server writes merge_train.enabled.
 * A project can override the global default in its cockpit settings.
 */
export function MergeTrainSection() {
  const { data: config } = useFlywheelConfig();
  const configMutation = useFlywheelConfigMutation();
  const enabled = config?.merge_train_enabled ?? false;

  return (
    <section className="mb-8" data-testid="awaiting-merge-merge-train">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Merge train</h2>
        <p className="text-xs text-muted-foreground">
          Assembles and batch-tests ready features per project, so you test one tree and merge it once.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Merge train"
          disabled={configMutation.isPending}
          title="On: ready features are assembled into a per-project test batch you can open, test, and merge in one click. Off: features stay in the list below and merge one at a time. Individual projects can override this default in their cockpit settings."
          onClick={() => configMutation.mutate({ merge_train_enabled: !enabled })}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground disabled:opacity-50"
        >
          <span
            className={`relative h-4 w-7 rounded-full border transition-colors ${
              enabled ? 'border-primary/60 bg-primary/25' : 'border-border bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
                enabled ? 'left-[15px] bg-primary' : 'left-0.5 bg-muted-foreground'
              }`}
            />
          </span>
          {enabled ? 'On' : 'Off'}
        </button>
      </div>
      <MergeTrainView active />
    </section>
  );
}


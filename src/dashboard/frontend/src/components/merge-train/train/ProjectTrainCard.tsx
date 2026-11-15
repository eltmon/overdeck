/**
 * One project's merge-train card (PAN-4753 WI-10, FR-19).
 *
 * Header: project name, mode chip (Auto-merge / Holds for UAT), `repo · forge`
 * and the project's Train switch. Then, in order: the intro line and any
 * train-off banner, the hero batch and older batch rows, the strike lane, the
 * queue, and the recent merges strip.
 *
 * D4: auto projects batch too (the window lane), so the batch section renders
 * for any project with batches. The hero is the live batch (the newest
 * `assembling` or `ready` batch, else the newest `superseded` one), else the
 * merged outcome with the rebuilds its merge voided folded under it
 * (PAN-5364, `batchSections.ts`). Other batches are `OlderBatchRow`s. Cars
 * that belong to a live `ready`/`assembling` batch render as its member
 * chips, not as rows.
 */
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../../DialogProvider';
import { canRetryAssembly, retryAssemblyConfirmCopy } from '../mergeTrainCopy';
import { ToggleSwitch } from '../../flywheel/primitives';
import { postJson } from '../mergeTrainApi';
import type { BoardProject } from './boardTypes';
import { BatchCard } from './BatchCard';
import { Pill } from './CarStatusPill';
import { OlderBatchRow } from './OlderBatchRow';
import { OutcomeBatch } from './OutcomeBatch';
import { RecentMergesStrip } from './RecentMergesStrip';
import { StrikeLane } from './StrikeLane';
import { TrainCarRow } from './TrainCarRow';
import {
  MODE_CHIP,
  RETRY_ASSEMBLY_LABEL,
  TRAIN_SWITCH_LABEL,
  TRAIN_SWITCH_TITLE_OFF,
  TRAIN_SWITCH_TITLE_ON,
  introLine,
  masterOffBanner,
  nextBatchLine,
  queueHeading,
  shortName,
  trainOffBanner,
} from './trainCopy';
import { inLiveHeroBatch, useInvalidateBoard, useNow, type LiveMergeRun } from './useMergeTrainBoard';
import { buildBatchSections } from './batchSections';

export { pickHeroBatch } from './batchSections';

export interface ProjectTrainCardProps {
  project: BoardProject;
  masterEnabled: boolean;
  runs?: ReadonlyMap<string, LiveMergeRun>;
  onNavigateIssue?: (issueId: string) => void;
}

export function ProjectTrainCard({ project, masterEnabled, runs, onNavigateIssue }: ProjectTrainCardProps) {
  const invalidate = useInvalidateBoard();
  const waiting = project.window?.waiting ?? 0;
  const now = useNow(30_000, waiting > 0);

  const trainSwitch = useMutation({
    mutationFn: (on: boolean) => postJson<{ value: string | null; effective: boolean }>(
      `/api/projects/${encodeURIComponent(project.projectKey)}/merge-train`,
      { value: on ? null : 'disabled' },
    ),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not change the merge train'),
  });

  const switchOn = trainSwitch.isPending && trainSwitch.variables !== undefined
    ? trainSwitch.variables
    : project.override !== 'disabled';
  const sections = buildBatchSections(project.batches);
  const hero = sections.hero;
  const older = sections.rows.flatMap((row) => (row.kind === 'single' ? [row.gen] : row.gens));
  const cars = project.cars.filter((car) => !inLiveHeroBatch(car, project.batches));
  const nextLine = nextBatchLine(project.window, now);
  const banner = !masterEnabled ? masterOffBanner(project.mode) : !project.enabled ? trainOffBanner(project.mode) : null;
  // merge-next refuses while the train is off, so Merge buttons hide then.
  const trainOn = masterEnabled && project.enabled;

  // PAN-4598: batches arrive newest first, so a failed newest batch with no
  // testable one means the last assembly failed. Retry is the forced assemble.
  const readyCars = project.cars.filter((car) => car.state === 'ready' || car.state === 'held');
  const lastAssemblyFailed = !hero && project.batches[0]?.status === 'failed' ? project.batches[0] : null;
  const showRetryAssembly = trainOn && lastAssemblyFailed !== null && canRetryAssembly({
    featureCount: readyCars.length,
    holdsForUat: project.mode === 'hold',
    perPrCount: readyCars.filter((car) => car.route === 'auto-merge').length,
  });
  const confirm = useConfirm();
  const retryAssembly = useMutation({
    mutationFn: () => postJson<{ projects?: Array<{ result?: { action: string }; error?: string }> }>(
      '/api/merge-train/assemble', { project: project.projectKey },
    ),
    onSuccess: (data) => {
      const action = data.projects?.[0]?.result?.action;
      if (action === 'assembled') toast.success('Rebuilt the batch');
      else toast.info(`Retry: ${action ?? data.projects?.[0]?.error ?? 'no change'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Retry failed'),
  });
  const onRetryAssembly = async () => {
    if (!lastAssemblyFailed) return;
    const copy = retryAssemblyConfirmCopy({ projectName: project.projectName, failedName: shortName(lastAssemblyFailed.name), readyCount: readyCars.length });
    if (await confirm(copy)) retryAssembly.mutate();
  };
  const repoLine = [project.repo, project.forge].filter(Boolean).join(' · ');

  return (
    <section
      data-testid={`merge-train-project-${project.projectKey}`}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <header className="space-y-1 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-medium text-foreground">{project.projectName}</h3>
          <Pill tone={project.mode === 'hold' ? 'warning' : 'muted'} testId={`mode-chip-${project.projectKey}`}>{MODE_CHIP[project.mode]}</Pill>
          <span className="ml-auto">
            <ToggleSwitch
              label={TRAIN_SWITCH_LABEL}
              checked={switchOn}
              disabled={trainSwitch.isPending}
              title={switchOn ? TRAIN_SWITCH_TITLE_ON : TRAIN_SWITCH_TITLE_OFF}
              testId={`merge-train-switch-${project.projectKey}`}
              onChange={(next) => trainSwitch.mutate(next)}
            />
          </span>
        </div>
        {repoLine && <div className="font-mono text-[11px] text-muted-foreground">{repoLine}</div>}
      </header>

      {project.error ? (
        <p className="text-[11px] text-muted-foreground" data-testid={`merge-train-error-${project.projectKey}`}>{project.error}</p>
      ) : (
        <>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{introLine(project)}</p>
          {banner && (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] text-foreground" data-testid={`train-off-banner-${project.projectKey}`}>
              {banner}
            </p>
          )}
          {(project.notices ?? []).map((notice) => (
            <p key={notice} className="text-[11px] text-muted-foreground" data-testid={`train-notice-${project.projectKey}`}>{notice}</p>
          ))}

          {showRetryAssembly && (
            <div>
              <button
                type="button"
                disabled={retryAssembly.isPending}
                onClick={() => void onRetryAssembly()}
                data-testid={`merge-train-retry-assembly-${project.projectKey}`}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {retryAssembly.isPending ? 'Retrying…' : RETRY_ASSEMBLY_LABEL}
              </button>
            </div>
          )}

          {hero ? (
            <div className="space-y-2" data-testid={`hero-batch-${project.projectKey}`}>
              <BatchCard gen={hero} projectKey={project.projectKey} projectName={project.projectName} hero mergeEnabled={trainOn} onNavigateIssue={onNavigateIssue} />
            </div>
          ) : sections.outcome && (
            <div className="space-y-2" data-testid={`hero-batch-${project.projectKey}`} data-outcome="true">
              <OutcomeBatch
                gen={sections.outcome}
                folded={sections.folded}
                projectKey={project.projectKey}
                projectName={project.projectName}
                mergeEnabled={trainOn}
                onNavigateIssue={onNavigateIssue}
              />
            </div>
          )}
          {older.length > 0 && (
            <div className="space-y-1.5">
              {older.map((gen) => (
                <OlderBatchRow key={gen.name} gen={gen}>
                  <BatchCard gen={gen} projectKey={project.projectKey} projectName={project.projectName} mergeEnabled={trainOn} onNavigateIssue={onNavigateIssue} />
                </OlderBatchRow>
              ))}
            </div>
          )}

          <StrikeLane strikes={project.strikes} runs={runs} onNavigateIssue={onNavigateIssue} />

          {cars.length > 0 && (
            <section className="space-y-1.5" data-testid={`train-queue-${project.projectKey}`}>
              <h4 className="text-[12px] font-medium text-foreground">{queueHeading(project.mode, cars.length)}</h4>
              {nextLine && <p className="text-[11px] text-muted-foreground" data-testid={`next-batch-${project.projectKey}`}>{nextLine}</p>}
              {cars.map((car, i) => (
                <TrainCarRow
                  key={car.issueId}
                  car={car}
                  order={i + 1}
                  projectKey={project.projectKey}
                  projectName={project.projectName}
                  run={runs?.get(car.issueId.toUpperCase())}
                  mergeEnabled={trainOn}
                  onNavigateIssue={onNavigateIssue}
                />
              ))}
            </section>
          )}

          <RecentMergesStrip recent={project.recent} />
        </>
      )}
    </section>
  );
}

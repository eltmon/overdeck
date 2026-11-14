/**
 * One project's merge-train card (PAN-4753 WI-10, FR-19).
 *
 * Header: project name, mode chip (Auto-merge / Holds for UAT), `repo · forge`
 * and the project's Train switch. Then, in order: the intro line and any
 * train-off banner, the hero batch and older batch rows, the strike lane, the
 * queue, and the recent merges strip.
 *
 * D4: auto projects batch too (the window lane), so the batch section renders
 * for any project with batches. The hero batch is the newest `assembling` or
 * `ready` batch, else the newest `superseded` one; every other batch in the
 * chain is an `OlderBatchRow` (none is hidden, FR-7). Cars that belong to a
 * live `ready`/`assembling` batch render as its member chips, not as rows.
 */
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ToggleSwitch } from '../../flywheel/primitives';
import { postJson } from '../mergeTrainApi';
import type { BoardProject, UatGenerationPayload } from './boardTypes';
import { BatchCard } from './BatchCard';
import { Pill } from './CarStatusPill';
import { OlderBatchRow } from './OlderBatchRow';
import { RecentMergesStrip } from './RecentMergesStrip';
import { StrikeLane } from './StrikeLane';
import { TrainCarRow } from './TrainCarRow';
import {
  MASTER_OFF_BANNER,
  MODE_CHIP,
  TRAIN_OFF_BANNER,
  TRAIN_SWITCH_LABEL,
  TRAIN_SWITCH_TITLE_OFF,
  TRAIN_SWITCH_TITLE_ON,
  introLine,
  nextBatchLine,
  queueHeading,
} from './trainCopy';
import { inLiveHeroBatch, useInvalidateBoard, useNow, type LiveMergeRun } from './useMergeTrainBoard';

/** The hero batch: newest assembling/ready, else newest superseded. Batches arrive newest first. */
export function pickHeroBatch(batches: readonly UatGenerationPayload[]): UatGenerationPayload | null {
  return batches.find((b) => b.status === 'assembling' || b.status === 'ready')
    ?? batches.find((b) => b.status === 'superseded')
    ?? null;
}

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
  const hero = pickHeroBatch(project.batches);
  const older = project.batches.filter((b) => b !== hero);
  const cars = project.cars.filter((car) => !inLiveHeroBatch(car, project.batches));
  const nextLine = nextBatchLine(project.window, now);
  const banner = !masterEnabled ? MASTER_OFF_BANNER : !project.enabled ? TRAIN_OFF_BANNER : null;
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

          {hero && (
            <div className="space-y-2" data-testid={`hero-batch-${project.projectKey}`}>
              <BatchCard gen={hero} projectKey={project.projectKey} projectName={project.projectName} hero onNavigateIssue={onNavigateIssue} />
            </div>
          )}
          {older.length > 0 && (
            <div className="space-y-1.5">
              {older.map((gen) => (
                <OlderBatchRow key={gen.name} gen={gen}>
                  <BatchCard gen={gen} projectKey={project.projectKey} projectName={project.projectName} onNavigateIssue={onNavigateIssue} />
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

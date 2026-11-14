/**
 * The Flywheel health strip (PAN-5283 FR-9). One wrapping row of the facts the
 * global header does not show: the newest completed main CI verdict, the
 * running build against it, the quality-gate queue, the next merge-train
 * batch, and the last release. It deliberately repeats nothing from the
 * header (agent count, GitHub quota, memory, Needs-you count). A fact whose
 * source is unknown is left out rather than shown as a guess.
 */
import type { FlywheelHealth } from '@overdeck/contracts';

import { formatAge } from '../../lib/flywheelApi';

/** `HH:MM` in the viewer's local 24-hour time. */
export function clockTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `oldest 24m` style age without the trailing "ago". */
function ageWithoutAgo(iso: string, nowMs: number): string {
  return formatAge(iso, nowMs).replace(/ ago$/, '');
}

const CONCLUSION_TONE: Record<string, string> = {
  success: 'text-success',
  failure: 'text-destructive',
  cancelled: 'text-muted-foreground',
};

export function FlywheelHealthStrip({ health, nowMs }: { health: FlywheelHealth; nowMs: number }) {
  const { mainCi, deployed, gateQueue, nextBatch, batchingPausedUntil, lastRelease } = health;
  return (
    <div
      data-testid="flywheel-health-strip"
      aria-label="Flywheel health"
      role="group"
      className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground"
    >
      {mainCi && (
        <span data-testid="flywheel-health-ci">
          main CI <span className={`font-medium ${CONCLUSION_TONE[mainCi.conclusion] ?? 'text-foreground'}`}>{mainCi.conclusion}</span>
          {' · '}
          {mainCi.url ? (
            <a href={mainCi.url} target="_blank" rel="noreferrer noopener" className="font-mono text-foreground underline decoration-muted-foreground/60 underline-offset-2">
              {mainCi.sha.slice(0, 7)}
            </a>
          ) : (
            <span className="font-mono text-foreground">{mainCi.sha.slice(0, 7)}</span>
          )}
        </span>
      )}
      {deployed && (
        <span data-testid="flywheel-health-deployed" title={`Running build ${deployed.buildCommit.slice(0, 7)}`}>
          {deployed.behindVerdict === 0 ? (
            <>deployed <span className="font-medium text-foreground">= main CI verdict</span></>
          ) : deployed.behindVerdict === null ? (
            <>deployed <span className="font-mono text-foreground">{deployed.buildCommit.slice(0, 7)}</span></>
          ) : (
            <>deployed <span className="font-medium text-warning-foreground">{deployed.behindVerdict} commit{deployed.behindVerdict === 1 ? '' : 's'} behind</span></>
          )}
        </span>
      )}
      <span data-testid="flywheel-health-gates">
        gates <span className="font-medium text-foreground">{gateQueue.running} running · {gateQueue.queued} queued</span>
        {gateQueue.oldestWaitSince && <> · oldest {ageWithoutAgo(gateQueue.oldestWaitSince, nowMs)}</>}
      </span>
      <span data-testid="flywheel-health-batch">
        {batchingPausedUntil ? (
          <>batching paused until <span className="font-medium text-foreground">{clockTime(batchingPausedUntil)}</span></>
        ) : nextBatch ? (
          <>next batch <span className="font-medium text-foreground">{nextBatch.members.length} PR{nextBatch.members.length === 1 ? '' : 's'} · {nextBatch.status}</span></>
        ) : (
          'no batch forming'
        )}
      </span>
      {lastRelease && (
        <span data-testid="flywheel-health-release">
          release{' '}
          {lastRelease.url ? (
            <a href={lastRelease.url} target="_blank" rel="noreferrer noopener" className="font-mono text-foreground underline decoration-muted-foreground/60 underline-offset-2">
              {lastRelease.tag}
            </a>
          ) : (
            <span className="font-mono text-foreground">{lastRelease.tag}</span>
          )}
          {' · '}
          {ageWithoutAgo(lastRelease.at, nowMs)}
        </span>
      )}
    </div>
  );
}

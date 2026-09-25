/**
 * The app-header needs-you indicator (PAN-4199 WI-16). Counts what is waiting
 * on the operator right now: the loop's own needs-you line from its newest
 * tick, plus every in-flight row the pipeline marked `needs-you`. Hidden at
 * zero — a header badge that is always present stops being a signal.
 *
 * Clicking it asks the Flywheel page to reveal the block (see
 * `lib/flywheelReveal`) and then hands the host its navigation.
 */
import { useFlywheelStatus } from '../../lib/flywheelApi';
import { requestRevealNeedsYou } from '../../lib/flywheelReveal';
import { StatusBadge } from './primitives';

export function NeedsYouIndicator({ onActivate }: { onActivate?: () => void }) {
  // The header is on every page, so it polls at the sidebar's slow cadence;
  // the Flywheel page's own 5 s observer takes over while that page is open.
  const { data } = useFlywheelStatus({ refetchInterval: 30_000 });
  if (!data) return null;

  const count = (data.lastTick?.needsYou ? 1 : 0)
    + data.inFlight.filter((row) => row.attention === 'needs-you').length;
  if (count === 0) return null;

  return (
    <button
      type="button"
      aria-label={`${count} thing${count === 1 ? '' : 's'} need you`}
      title="Show what the flywheel is waiting on you for"
      onClick={() => {
        requestRevealNeedsYou();
        onActivate?.();
      }}
    >
      <StatusBadge tone="warning" testId="flywheel-needs-you-indicator">Needs you · {count}</StatusBadge>
    </button>
  );
}

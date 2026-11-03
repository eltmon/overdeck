/** "Updating…" over the cached phone screens while the connection comes back after a resume (FR-13). */
import { useEffect, useState } from 'react';

import { useConnectionPhase } from '../../../../src/dashboard/frontend/src/lib/connectionState';
import { RESUME_BANNER_WINDOW_MS, useResumedAt } from './lifecycle';

export function UpdatingBanner() {
  const resumedAt = useResumedAt();
  const phase = useConnectionPhase();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (resumedAt === null) return;
    const left = resumedAt + RESUME_BANNER_WINDOW_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [resumedAt]);

  const recent = resumedAt !== null && Date.now() - resumedAt < RESUME_BANNER_WINDOW_MS;
  if (!recent || phase === 'live') return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+3rem)] z-50 -translate-x-1/2 rounded-sm border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
    >
      Updating…
    </div>
  );
}

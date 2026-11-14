import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

import {
  bundleBuildCommit,
  isBuildDrift,
  markReloadedFor,
  reloadAlreadyTriedFor,
  startBuildDriftWatch,
  useBuildDrift,
} from '../lib/buildDrift';
import { hasSavedDraft } from '../lib/composerDraft';

interface NewBuildBannerProps {
  /** Test seam; defaults to bundleBuildCommit(). */
  bundleCommit?: string | null;
  /** Test seam; defaults to () => window.location.reload(). */
  reload?: () => void;
  /** Test seam; defaults to fetch. */
  fetchImpl?: typeof fetch;
  /** Web /m shell: pad the top safe-area inset (D-12). */
  safeAreaTop?: boolean;
}

/**
 * NewBuildBanner (PAN-5236) — tells a tab it is running older frontend code
 * than the server, with a Reload that keeps unsent drafts. See
 * docs/DASHBOARD-ARCHITECTURE.md § New-build banner.
 */
export function NewBuildBanner({ bundleCommit, reload, fetchImpl, safeAreaTop }: NewBuildBannerProps) {
  useEffect(() => startBuildDriftWatch(fetchImpl), [fetchImpl]);

  const serverCommit = useBuildDrift((s) => s.serverCommit);
  const bundle = bundleCommit === undefined ? bundleBuildCommit() : bundleCommit;

  if (bundle === null || serverCommit === null || !isBuildDrift(bundle, serverCommit) || reloadAlreadyTriedFor(serverCommit)) {
    return null;
  }

  const onReload = () => {
    markReloadedFor(serverCommit);
    (reload ?? (() => window.location.reload()))();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-component="new-build-banner"
      title={`This tab: ${bundle.slice(0, 8)} · server: ${serverCommit.slice(0, 8)}`}
      className={`flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs bg-warning/10 text-warning-foreground${safeAreaTop ? ' pt-[calc(env(safe-area-inset-top)+0.375rem)]' : ''}`}
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="flex-1 truncate">
        A newer Overdeck is running. Reload to update.{hasSavedDraft() && ' Unsent drafts are kept.'}
      </p>
      <button
        type="button"
        onClick={onReload}
        className="shrink-0 rounded-md border border-warning/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-warning/20"
      >
        Reload
      </button>
    </div>
  );
}

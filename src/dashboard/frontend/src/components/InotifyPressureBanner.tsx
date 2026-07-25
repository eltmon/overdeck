import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { useSystemHealth } from '../hooks/useSystemHealth';

const SYSCTL_FIX = "echo 'fs.inotify.max_user_watches = 2097152' | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system";

/**
 * Compact system-notices-row member (PAN-3063) shown when the host's
 * per-user inotify file-watcher budget crosses the warning/critical band.
 * Exhaustion makes any new file-watching process (Vite dev servers, test
 * watchers) die with ENOSPC while everything else looks healthy, so the
 * banner carries the numbers and a copyable operator fix — Overdeck never
 * runs sudo itself.
 */
export function InotifyPressureBanner() {
  const { data } = useSystemHealth();
  const pressureReason = data?.host.reasons.find(
    (entry) => entry.code.startsWith('host.linux.inotify_watches.'),
  );
  if (!data || !pressureReason) return null;

  const critical = pressureReason.code === 'host.linux.inotify_watches.critical';
  const used = data.host.metrics.inotifyWatchesUsed;
  const max = data.host.metrics.inotifyWatchesMax;
  const usage = used != null && max != null
    ? `${used.toLocaleString()} of ${max.toLocaleString()} file watchers in use`
    : 'file-watcher usage is near the limit';
  const percent = pressureReason.observed != null ? ` (${Math.round(pressureReason.observed)}%)` : '';

  const copyFix = async () => {
    try {
      await navigator.clipboard.writeText(SYSCTL_FIX);
      toast.success('Fix command copied — run it in a terminal to raise and persist the limit');
    } catch {
      toast.error(`Copy failed — run: ${SYSCTL_FIX}`);
    }
  };

  return (
    <div
      className={`${critical ? 'bg-destructive/10' : 'bg-warning/10'} flex flex-1 items-center gap-2 px-4 py-1.5`}
      data-testid="inotify-pressure-banner"
    >
      <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${critical ? 'text-destructive' : 'text-warning-foreground'}`} />
      <p
        className={`flex-1 truncate text-xs ${critical ? 'text-destructive' : 'text-warning-foreground'}`}
        title={`inotify watches are a per-user kernel budget shared by every process and container on this host. When it is exhausted, new file-watching dev servers fail to start with ENOSPC. ${usage}${percent}. Raise and persist the limit with: ${SYSCTL_FIX}`}
      >
        <span className="font-medium">
          {critical ? 'File watchers exhausted' : 'File watchers running low'}
        </span>
        {' — '}{usage}{percent}; new dev servers {critical ? 'will' : 'may'} fail with ENOSPC
      </p>
      <button
        type="button"
        onClick={copyFix}
        className={`h-[26px] shrink-0 rounded-sm px-[10px] text-[11px] font-medium ${
          critical
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-warning/20 text-warning-foreground hover:bg-warning/30'
        }`}
      >
        Copy fix
      </button>
    </div>
  );
}

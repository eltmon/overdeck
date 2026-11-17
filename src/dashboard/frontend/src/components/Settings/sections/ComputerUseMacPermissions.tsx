/**
 * Settings → Computer Use on macOS (PAN-5463 WI-5): the Accessibility and
 * Screen Recording rows for the Overdeck Computer Use helper. Each row reads
 * the darwin readiness check with the same id. A permission that is not
 * allowed gets an "Open settings" button that opens that System Settings pane
 * on the host through the helper.
 */
import type { ComputerUseStatusView } from '../hooks/useComputerUseStatus';

export type MacPermissionId = 'accessibility' | 'screen-recording';

const ROWS: Array<{ id: MacPermissionId; label: string }> = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'screen-recording', label: 'Screen Recording' },
];

const SECONDARY_BUTTON =
  'rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed';

export function ComputerUseMacPermissions({
  checks,
  busy,
  onOpen,
}: {
  checks: ComputerUseStatusView['checks'];
  busy: boolean;
  onOpen: (id: MacPermissionId) => void;
}) {
  return (
    <ul data-testid="computer-use-mac-permissions" className="space-y-2">
      {ROWS.map((row) => {
        const allowed = checks.find((check) => check.id === row.id)?.status === 'ok';
        return (
          <li key={row.id} data-testid={`computer-use-permission-${row.id}`} className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">{row.label}</span>
            <span className="flex items-center gap-3">
              <span className={`text-xs ${allowed ? 'text-muted-foreground' : 'text-warning-foreground'}`}>
                {allowed ? 'Allowed' : 'Not allowed'}
              </span>
              {allowed ? null : (
                <button
                  type="button"
                  data-testid={`computer-use-open-${row.id}`}
                  disabled={busy}
                  onClick={() => onOpen(row.id)}
                  className={SECONDARY_BUTTON}
                >
                  Open settings
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

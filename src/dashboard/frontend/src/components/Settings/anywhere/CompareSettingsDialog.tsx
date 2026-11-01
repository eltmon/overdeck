/**
 * Compare settings (PAN-4651 FR-9, D-4651-20): the config.yaml keys whose set
 * values differ between this machine and a linked one. Secrets show only
 * "set" or "not set". Each row this machine sets offers a copyable
 * `pan admin config set …` line to run on the other machine; nothing here
 * changes either machine. With a Tailscale route, **Open <label>'s dashboard**
 * goes to that machine's own Settings.
 */
import { useQuery } from '@tanstack/react-query';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';

import { loadSettingsCompare, type ResolvedSetting } from './machinesApi';

function cell(setting: ResolvedSetting | null): string {
  if (setting === null) return 'not set (default)';
  if ('secret' in setting) return setting.set ? 'set' : 'not set';
  return setting.value;
}

async function copy(line: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(line);
    toast.success('Copied');
  } catch {
    toast.error('Clipboard unavailable — copy the line by hand');
  }
}

export function CompareSettingsDialog({ machine, label, onClose }: { machine: string; label: string; onClose: () => void }) {
  const { data, error, isLoading } = useQuery({ queryKey: ['settings-compare', machine], queryFn: () => loadSettingsCompare(machine) });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-settings-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="compare-settings-title" className="text-base font-medium text-foreground">Compare settings with {label}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto text-sm space-y-3">
          {isLoading && <p className="text-xs text-muted-foreground">Reading {label}'s settings…</p>}
          {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
          {data && (
            <>
              <p className="text-xs text-muted-foreground">
                Only values set in config.yaml are compared. Run a copied line on {label} to match this machine; secrets never leave either machine, so set secrets are always listed.
              </p>
              {data.dashboardUrl && (
                <a href={data.dashboardUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-primary hover:underline">
                  Open {label}'s dashboard
                </a>
              )}
              {data.differences.length === 0 ? (
                <p className="text-xs text-muted-foreground">No differences.</p>
              ) : (
                <table className="w-full text-xs" data-testid="settings-compare-table">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-normal py-1">Setting</th><th className="text-left font-normal py-1">Here</th><th className="text-left font-normal py-1">{label}</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.differences.map((row) => (
                      <tr key={row.key} className="border-t border-border/50" data-testid={`settings-diff-${row.key}`}>
                        <td className="py-1 pr-2 font-mono">{row.key}</td>
                        <td className="py-1 pr-2 font-mono">{cell(row.here)}</td>
                        <td className="py-1 pr-2 font-mono">{cell(row.there)}</td>
                        <td className="py-1 text-right">
                          {row.copyLine && (
                            <button type="button" onClick={() => void copy(row.copyLine!)} title={row.copyLine} aria-label={`Copy ${row.copyLine}`} className="text-muted-foreground hover:text-foreground">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

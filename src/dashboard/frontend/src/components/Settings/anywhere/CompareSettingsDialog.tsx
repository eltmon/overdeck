/**
 * Compare settings (PAN-4651 FR-9, D-4651-20): the config.yaml keys whose set
 * values differ between this machine and a linked one. Secrets show only
 * "set" or "not set". Each row this machine sets offers a copyable
 * `pan admin config set …` line to run on the other machine; nothing here
 * changes either machine. With a Tailscale route, **Open <label>'s dashboard**
 * goes to that machine's own Settings.
 */
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Modal } from '../../shared/Modal';
import styles from './anywhereDialog.module.css';
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
    <Modal
      title={`Compare settings with ${label}`}
      onClose={onClose}
      wide
      footer={<button type="button" onClick={onClose} className={styles.button}>Close</button>}
    >
      <div className={styles.form}>
        {isLoading && <p className={styles.status}>Reading {label}'s settings…</p>}
        {error && <p className={styles.error} role="alert">{(error as Error).message}</p>}
        {data && (
          <>
            <p className={styles.hint}>
              Only values set in config.yaml are compared. Run a copied line on {label} to match this machine; secrets never leave either machine, so set secrets are always listed.
            </p>
            {data.dashboardUrl && (
              <a href={data.dashboardUrl} target="_blank" rel="noreferrer" className="self-start text-[13px] text-primary hover:underline">
                Open {label}'s dashboard
              </a>
            )}
            {data.differences.length === 0 ? (
              <p className={styles.hint}>No differences.</p>
            ) : (
              <table className="w-full table-fixed text-[13px]" data-testid="settings-compare-table">
                <colgroup><col className="w-[56%]" /><col className="w-[14%]" /><col /><col className="w-8" /></colgroup>
                <thead className="text-muted-foreground">
                  <tr><th className="text-left font-normal py-1.5">Setting</th><th className="text-left font-normal py-1.5">Here</th><th className="text-left font-normal py-1.5 truncate" title={label}>{label}</th><th /></tr>
                </thead>
                <tbody>
                  {data.differences.map((row) => (
                    <tr key={row.key} className="border-t border-border/50" data-testid={`settings-diff-${row.key}`}>
                      <td className={`py-1.5 pr-3 break-all ${styles.mono}`}>{row.key}</td>
                      <td className={`py-1.5 pr-3 break-words ${styles.mono}`}>{cell(row.here)}</td>
                      <td className={`py-1.5 pr-3 break-words ${styles.mono}`}>{cell(row.there)}</td>
                      <td className="py-1.5 text-right">
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
    </Modal>
  );
}

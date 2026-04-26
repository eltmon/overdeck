/**
 * UpgradeAnnouncement — one-time banner shown on first dashboard launch after
 * upgrading to 0.7.0 (command taxonomy reorganization).
 *
 * Renders the full migration table from QUICK-REFERENCE.md inline, is
 * dismissible, and persists dismissed state to localStorage so it doesn't
 * reappear on subsequent page loads.
 */

import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';

const STORAGE_KEY = 'pan-upgrade-announcement-0.7.0-dismissed';

const MIGRATION_TABLE: Array<{ legacy: string; current: string }> = [
  { legacy: 'pan work issue <id>', current: 'pan start <id>' },
  { legacy: 'pan work plan <id>', current: 'pan plan <id>' },
  { legacy: 'pan plan-finalize <id>', current: 'pan plan finalize <id>' },
  { legacy: 'pan work list', current: 'pan issues' },
  { legacy: 'pan work triage', current: 'pan issues' },
  { legacy: 'pan work tell <id>', current: 'pan tell <id>' },
  { legacy: 'pan work kill <id>', current: 'pan kill <id>' },
  { legacy: 'pan work resume <id>', current: 'pan resume <id>' },
  { legacy: 'pan work recover <id>', current: 'pan recover <id>' },
  { legacy: 'pan work done <id>', current: 'pan done <id>' },
  { legacy: 'pan work approve <id>', current: 'pan approve <id>' },
  { legacy: 'pan work reopen <id>', current: 'pan reopen <id>' },
  { legacy: 'pan work wipe <id>', current: 'pan wipe <id>' },
  { legacy: 'pan work sync-main <id>', current: 'pan sync-main <id>' },
  { legacy: 'pan work close-out <id>', current: 'pan close <id>' },
  { legacy: 'pan work pending', current: 'pan review pending' },
  { legacy: 'pan work request-review <id>', current: 'pan review request <id>' },
  { legacy: 'pan work reset-review <id>', current: 'pan review reset <id>' },
  { legacy: 'pan work shadow <id>', current: 'pan show <id>' },
  { legacy: 'pan work cv <id>', current: 'pan show <id> --cv' },
  { legacy: 'pan work context <id>', current: 'pan show <id> --context' },
  { legacy: 'pan work health <id>', current: 'pan show <id> --health' },
  { legacy: 'pan cloister *', current: 'pan admin cloister *' },
  { legacy: 'pan specialists *', current: 'pan admin specialists *' },
  { legacy: 'pan remote *', current: 'pan admin remote *' },
  { legacy: 'pan db *', current: 'pan admin db *' },
  { legacy: 'pan beads *', current: 'pan admin beads *' },
  { legacy: 'pan config *', current: 'pan admin config *' },
  { legacy: 'pan setup hooks', current: 'pan admin hooks install' },
  { legacy: 'pan work tldr *', current: 'pan admin tldr *' },
  { legacy: 'pan work hook *', current: 'pan admin fpp *' },
  { legacy: 'pan work linear-states', current: 'pan admin tracker linear-states' },
  { legacy: 'pan work linear-cleanup', current: 'pan admin tracker linear-cleanup' },
  { legacy: 'pan migrate-config', current: 'pan admin migrate-config' },
  { legacy: 'pan sync-costs', current: 'pan cost sync' },
];

export function UpgradeAnnouncement() {
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(STORAGE_KEY) === '1'
  );

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="bg-primary/10 border-b-2 border-primary/30 shrink-0">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-primary text-sm font-semibold mb-1">
            Panopticon 0.7.0 — Command Taxonomy Reorganization
          </p>
          <p className="text-primary/70 text-xs mb-3">
            The <code className="font-mono bg-primary/10 px-1 rounded">pan work</code> prefix has been removed.
            Lifecycle verbs are now top-level. Plumbing commands moved to{' '}
            <code className="font-mono bg-primary/10 px-1 rounded">pan admin</code>.
            Run <code className="font-mono bg-primary/10 px-1 rounded">pan doctor</code> to check for legacy
            invocations in your shell config.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-primary/60 hover:text-primary/80 select-none">
              Show full migration table ({MIGRATION_TABLE.length} changes)
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1 pr-4 font-medium">Legacy</th>
                    <th className="pb-1 font-medium">New</th>
                  </tr>
                </thead>
                <tbody>
                  {MIGRATION_TABLE.map(({ legacy, current }) => (
                    <tr key={legacy} className="border-t border-border/50">
                      <td className="py-0.5 pr-4">
                        <code className="font-mono text-muted-foreground line-through">{legacy}</code>
                      </td>
                      <td className="py-0.5">
                        <span className="flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 text-primary/50 shrink-0" />
                          <code className="font-mono text-primary">{current}</code>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
        <button
          onClick={dismiss}
          className="text-primary/60 hover:text-primary/90 shrink-0 mt-0.5"
          aria-label="Dismiss upgrade announcement"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * SetupChecklistBanner (PAN-774) — first-run host-tool checklist.
 *
 * Overdeck drives host utilities (tmux, git, node, the Claude Code CLI) that
 * no install flavor bundles. GET /api/prerequisites reports what the SERVER
 * sees on PATH — exactly what spawned sessions will see. The banner appears
 * only while a REQUIRED tool is missing; the expanded checklist also lists
 * optional integrations (gh, tasks, Docker, Codex) with copyable install
 * commands. Overdeck never runs the installs itself — system packages need
 * sudo/user consent.
 */

interface PrerequisiteCheck {
  id: string;
  name: string;
  required: boolean;
  purpose: string;
  found: boolean;
  version: string | null;
  install: { linux: string; mac: string; win: string };
}

interface PrerequisitesReport {
  platform: string;
  allRequiredFound: boolean;
  checks: PrerequisiteCheck[];
}

const DISMISS_KEY = 'overdeck-setup-checklist-dismissed';

function installHintFor(check: PrerequisiteCheck, platform: string): string {
  if (platform === 'darwin') return check.install.mac;
  if (platform === 'win32') return check.install.win;
  return check.install.linux;
}

function CopyableCommand({ command }: { command: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(command).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    );
  };
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <code className="font-mono text-xs bg-card-2 border border-border rounded-sm px-1.5 py-0.5 truncate">
        {command}
      </code>
      <button
        onClick={copy}
        className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-card-2 shrink-0"
        aria-label={`Copy install command for ${command}`}
        title="Copy"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

function ChecklistRow({ check, platform }: { check: PrerequisiteCheck; platform: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 min-w-0">
      {check.found ? (
        <Check className="w-4 h-4 text-muted-foreground shrink-0" aria-label="installed" />
      ) : check.required ? (
        <AlertTriangle className="w-4 h-4 text-warning-foreground shrink-0" aria-label="missing — required" />
      ) : (
        <span className="w-4 h-4 text-muted-foreground text-center shrink-0" aria-label="missing — optional">·</span>
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{check.name}</span>
        {!check.required && <span className="ml-2 text-xs text-muted-foreground">optional</span>}
        <span className="ml-2 text-xs text-muted-foreground">{check.purpose}</span>
      </div>
      {check.found ? (
        <span className="font-mono text-xs text-muted-foreground truncate max-w-48">{check.version}</span>
      ) : (
        <CopyableCommand command={installHintFor(check, platform)} />
      )}
    </div>
  );
}

export function SetupChecklistBanner() {
  const [expanded, setExpanded] = useState(false);
  const [dismissedSet, setDismissedSet] = useState<string>(() => localStorage.getItem(DISMISS_KEY) ?? '');

  const { data: report, refetch, isFetching } = useQuery({
    queryKey: ['prerequisites'],
    queryFn: async (): Promise<PrerequisitesReport> => {
      const res = await fetch('/api/prerequisites');
      if (!res.ok) throw new Error('Failed to check prerequisites');
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const missingRequired = useMemo(
    () => (report?.checks ?? []).filter((check) => check.required && !check.found),
    [report],
  );
  const missingKey = missingRequired.map((check) => check.id).sort().join(',');

  if (!report || missingRequired.length === 0) return null;
  if (!expanded && dismissedSet === missingKey) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, missingKey);
    setDismissedSet(missingKey);
    setExpanded(false);
  };

  return (
    <div className="bg-warning/8 border-b border-warning/32 shrink-0">
      <div className="px-4 py-3 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
        <p className="text-sm font-medium text-warning-foreground flex-1 min-w-0">
          Finish setting up Overdeck — missing required {missingRequired.length === 1 ? 'tool' : 'tools'}:{' '}
          <span className="font-mono">{missingRequired.map((check) => check.id).join(', ')}</span>. Agents cannot
          start until {missingRequired.length === 1 ? 'it is' : 'they are'} installed.
        </p>
        <button
          onClick={() => setExpanded((value) => !value)}
          className="px-3 py-1.5 text-sm font-medium rounded-sm bg-warning/8 border border-warning/32 text-warning-foreground hover:bg-warning/16 shrink-0"
        >
          {expanded ? 'Hide checklist' : 'Show checklist'}
        </button>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-card-2 shrink-0"
          aria-label="Dismiss setup checklist"
          title="Dismiss (reappears if the missing set changes)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-3">
          <div className="bg-card border border-border rounded-sm px-4 py-2 divide-y divide-border">
            {report.checks.map((check) => (
              <ChecklistRow key={check.id} check={check} platform={report.platform} />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="px-3 py-1.5 text-sm font-medium rounded-sm bg-card border border-border text-foreground hover:bg-card-2 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Re-check
            </button>
            <span className="text-xs text-muted-foreground">
              Run the commands in a terminal, then re-check. Install commands are for this machine ({report.platform === 'darwin' ? 'macOS' : report.platform === 'win32' ? 'Windows' : 'Linux'}).
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import { useUiMode } from '../../lib/simple/uiMode';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import {
  CopyableCommand,
  installHintFor,
  type PrerequisiteCheck,
  type PrerequisitesReport,
} from '../SetupChecklistBanner';

/**
 * GetSetUpCard (PAN-4282 D7, D8, D10) — the Home-page "Get set up" checklist.
 *
 * Never blocks and never runs installs: every row shows a copyable command
 * for the user to run themselves. Shares the `['prerequisites']` query key
 * with SetupChecklistBanner (D10) so a Re-check here also updates the banner
 * on other tabs, and vice versa.
 */

interface AuthCheck {
  ok: boolean;
  detail: string;
}

interface GhLoginCheck {
  installed: boolean;
  ok: boolean;
}

interface BackendCheck {
  name: 'herdr' | 'tmux';
  available: boolean;
  reason: string | null;
}

interface MemoryCheck {
  availableGb: number;
  warnGb: number;
  low: boolean;
}

interface GetSetUpReport extends PrerequisitesReport {
  auth?: { claude: AuthCheck; gh: GhLoginCheck };
  backend?: BackendCheck;
  memory?: MemoryCheck | null;
}

const DISMISS_KEY = 'overdeck:get-set-up-dismissed';

interface SetupStrings {
  title: string;
  subtitle: string;
  hide: string;
  setUp: string;
  recheck: string;
  claudeDone: string;
  claudeTodo: string;
  githubDone: string;
  githubTodo: string;
  agentsDone: string;
  agentsTodo: string;
  terminalsDone: string;
  terminalsTodo: string;
  dockerDone: string;
  dockerTodo: string;
  memoryPrefix: string;
  memoryLow: string;
  runThis: string;
}

const ADVANCED_SETUP_STRINGS: SetupStrings = {
  ...SIMPLE_STRINGS.setup,
  claudeTodo: 'Log in to Claude Code',
  githubTodo: 'Log in to the GitHub CLI (gh)',
  agentsDone: 'Herdr is ready',
  agentsTodo: 'Herdr is not ready',
  terminalsDone: 'tmux is installed',
  terminalsTodo: 'Install tmux (plain terminals)',
  dockerDone: 'Docker is installed',
  dockerTodo: 'Docker (optional)',
};

interface Row {
  id: string;
  done: boolean;
  label: string;
  commands: string[];
}

function findCheck(checks: PrerequisiteCheck[], id: string): PrerequisiteCheck | undefined {
  return checks.find((check) => check.id === id);
}

function buildRows(
  report: GetSetUpReport,
  strings: SetupStrings,
  platform: string,
): Row[] {
  const rows: Row[] = [];

  if (report.auth) {
    const { claude, gh } = report.auth;
    rows.push({
      id: 'claude',
      done: claude.ok,
      label: claude.ok ? strings.claudeDone : strings.claudeTodo,
      commands: claude.ok ? [] : ['claude', '/login'],
    });

    const ghCheck = findCheck(report.checks, 'gh');
    rows.push({
      id: 'github',
      done: gh.ok,
      label: gh.ok ? strings.githubDone : strings.githubTodo,
      commands: gh.ok
        ? []
        : gh.installed || !ghCheck
          ? ['gh auth login']
          : [installHintFor(ghCheck, platform)],
    });
  }

  if (report.backend && report.backend.name !== 'tmux') {
    const herdrCheck = findCheck(report.checks, 'herdr');
    const { available } = report.backend;
    rows.push({
      id: 'agents',
      done: available,
      label: available ? strings.agentsDone : strings.agentsTodo,
      commands: available || !herdrCheck ? [] : [installHintFor(herdrCheck, platform)],
    });
  }

  const tmuxCheck = findCheck(report.checks, 'tmux');
  if (tmuxCheck) {
    rows.push({
      id: 'terminals',
      done: tmuxCheck.found,
      label: tmuxCheck.found ? strings.terminalsDone : strings.terminalsTodo,
      commands: tmuxCheck.found ? [] : [installHintFor(tmuxCheck, platform)],
    });
  }

  const dockerCheck = findCheck(report.checks, 'docker');
  if (dockerCheck) {
    rows.push({
      id: 'docker',
      done: dockerCheck.found,
      label: dockerCheck.found ? strings.dockerDone : strings.dockerTodo,
      commands: dockerCheck.found ? [] : [installHintFor(dockerCheck, platform)],
    });
  }

  return rows;
}

/** A failing required row keeps the card visible even after dismissal (D7). */
function hasRequiredFailing(report: GetSetUpReport): boolean {
  if (report.checks.some((check) => check.required && !check.found)) return true;
  if (report.backend && !report.backend.available) return true;
  if (report.auth && !report.auth.claude.ok) return true;
  return false;
}

export function GetSetUpCard() {
  const mode = useUiMode((state) => state.mode);
  const strings = mode === 'simple' ? SIMPLE_STRINGS.setup : ADVANCED_SETUP_STRINGS;
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: report } = useQuery({
    queryKey: ['prerequisites'],
    queryFn: async (): Promise<GetSetUpReport> => {
      const res = await fetch('/api/prerequisites');
      if (!res.ok) throw new Error('Failed to check prerequisites');
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const rows = useMemo(
    () => (report ? buildRows(report, strings, report.platform) : []),
    [report, strings],
  );
  const requiredFailing = useMemo(() => (report ? hasRequiredFailing(report) : false), [report]);

  if (!report) return null;
  if (dismissed && !requiredFailing) return null;

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hide = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // localStorage unavailable (private mode, blocked storage) — non-fatal.
    }
    setDismissed(true);
  };

  const recheck = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/prerequisites?refresh=1');
      if (res.ok) {
        const json = await res.json();
        queryClient.setQueryData(['prerequisites'], json);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <section
      data-component="get-set-up-card"
      aria-labelledby="get-set-up-title"
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="get-set-up-title" className="text-sm font-semibold text-foreground">{strings.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{strings.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void recheck()}
            disabled={isRefreshing}
            className="px-3 py-1.5 text-sm font-medium rounded-sm bg-card border border-border text-foreground hover:bg-card-2 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {strings.recheck}
          </button>
          <button
            onClick={hide}
            className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-card-2"
            aria-label={strings.hide}
            title={strings.hide}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="py-2">
            <div className="flex items-center gap-3 min-w-0">
              {row.done ? (
                <Check className="w-4 h-4 text-muted-foreground shrink-0" aria-label="done" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning-foreground shrink-0" aria-label="to do" />
              )}
              <span className="flex-1 text-sm text-foreground min-w-0">{row.label}</span>
              {!row.done && row.commands.length > 0 && (
                <button
                  onClick={() => toggleRow(row.id)}
                  className="px-2.5 py-1 text-xs font-medium rounded-sm bg-card border border-border text-foreground hover:bg-card-2 shrink-0"
                >
                  {strings.setUp}
                </button>
              )}
            </div>
            {!row.done && row.commands.length > 0 && expandedRows.has(row.id) && (
              <div className="mt-2 ml-7 flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{strings.runThis}</span>
                {row.commands.map((command) => (
                  <CopyableCommand key={command} command={command} />
                ))}
              </div>
            )}
          </div>
        ))}
        {report.memory && (
          <div className="py-2 flex items-center gap-3 min-w-0">
            <span className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-sm text-foreground min-w-0">
              {strings.memoryPrefix}{report.memory.availableGb} GB
              {report.memory.low && (
                <span className="block text-xs text-warning-foreground mt-0.5">{strings.memoryLow}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

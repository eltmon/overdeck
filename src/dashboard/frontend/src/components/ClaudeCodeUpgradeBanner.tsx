import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { CopyableCommand } from './SetupChecklistBanner';
import { popoutTerminal } from './TerminalPanel';

/**
 * ClaudeCodeUpgradeBanner (PAN-4359) — shown when the launch binary is older
 * than a configured model's minimum. GET /api/claude-code/status is the same
 * check the launch gate itself runs; this just surfaces it before a launch
 * fails. Overdeck only runs the upgrade itself when the install method is
 * user-writable — see claude-code/version.ts's upgrade-plan rules.
 */

export interface ClaudeCodeRequirement {
  model: string;
  displayName: string;
  minVersion: string;
  sources: string[];
  satisfied: boolean | null;
}

export interface ClaudeCodeUpgradePlan {
  method: 'npm' | 'native' | 'homebrew' | 'unknown';
  argv: string[] | null;
  display: string;
  runnable: boolean;
  reason?: 'not-writable' | 'unknown-install' | 'unsupported-platform' | 'brew-missing';
}

export interface ClaudeCodeStatus {
  found: boolean;
  binaryPath: string | null;
  version: string | null;
  upgrade: ClaudeCodeUpgradePlan | null;
  requirements: ClaudeCodeRequirement[];
  outdated: boolean;
  checkedAt: string;
}

const UPGRADE_POLL_MS = 5_000;
const IDLE_POLL_MS = 10 * 60_000;
const UPGRADE_TIMEOUT_MS = 10 * 60_000;

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** null unless the launch binary is found and outdated for at least one configured model. */
export function claudeCodeBannerMessage(status: ClaudeCodeStatus): string | null {
  if (!status.found || !status.outdated) return null;
  const unmet = status.requirements.filter((requirement) => requirement.satisfied === false);
  if (unmet.length === 0) return null;

  const top = unmet.reduce((highest, requirement) =>
    compareVersions(requirement.minVersion, highest.minVersion) > 0 ? requirement : highest,
  );
  const message = `Claude Code ${status.version} is older than ${top.displayName} needs (${top.minVersion}).`;
  const extra = unmet.length - 1;
  return extra > 0 ? `${message} and ${extra} more model(s)` : message;
}

export function ClaudeCodeUpgradeBanner() {
  const [upgrading, setUpgrading] = useState(false);
  const upgradingRef = useRef(false);
  const upgradeStartedAt = useRef<number | null>(null);

  useEffect(() => {
    upgradingRef.current = upgrading;
  }, [upgrading]);

  const { data: status, refetch } = useQuery({
    queryKey: ['claude-code-status'],
    queryFn: async (): Promise<ClaudeCodeStatus> => {
      const url = upgradingRef.current ? '/api/claude-code/status?refresh=1' : '/api/claude-code/status';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to check Claude Code status');
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: upgrading ? UPGRADE_POLL_MS : IDLE_POLL_MS,
  });

  useEffect(() => {
    if (!upgrading) return;
    if (status && !status.outdated) {
      setUpgrading(false);
      upgradeStartedAt.current = null;
      return;
    }
    if (upgradeStartedAt.current !== null && Date.now() - upgradeStartedAt.current > UPGRADE_TIMEOUT_MS) {
      setUpgrading(false);
      upgradeStartedAt.current = null;
    }
  }, [upgrading, status]);

  if (!status) return null;
  const message = claudeCodeBannerMessage(status);
  if (!message) return null;

  const upgrade = status.upgrade;

  const recheck = async () => {
    await refetch();
  };

  const startUpgrade = async () => {
    try {
      const res = await fetch('/api/claude-code/upgrade', { method: 'POST' });
      if (res.status === 200 || res.status === 409) {
        const body = await res.json() as { sessionName: string };
        popoutTerminal(body.sessionName, 'Upgrade Claude Code');
        upgradeStartedAt.current = Date.now();
        setUpgrading(true);
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? 'Could not start the Claude Code upgrade');
    } catch {
      toast.error('Could not start the Claude Code upgrade');
    }
  };

  return (
    <div className="bg-warning/8 border-b border-warning/32 shrink-0" data-component="claude-code-upgrade-banner">
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
        <p className="text-sm font-medium text-warning-foreground flex-1 min-w-0">
          {message} Running agents and conversations keep their current Claude Code; new launches use the upgraded one.
        </p>
        {upgrade?.runnable ? (
          <button
            onClick={() => void startUpgrade()}
            disabled={upgrading}
            className="px-3 py-1.5 text-sm font-medium rounded-sm bg-warning/8 border border-warning/32 text-warning-foreground hover:bg-warning/16 shrink-0 disabled:opacity-50"
          >
            {upgrading ? 'Upgrading…' : 'Upgrade Claude Code'}
          </button>
        ) : upgrade ? (
          <>
            <CopyableCommand command={upgrade.display} />
            <button
              onClick={() => void recheck()}
              className="px-3 py-1.5 text-sm font-medium rounded-sm bg-card border border-border text-foreground hover:bg-card-2 shrink-0"
            >
              Re-check
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

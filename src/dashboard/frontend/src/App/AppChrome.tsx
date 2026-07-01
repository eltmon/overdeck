import { AlertTriangle, CheckCircle2, History, RefreshCw, Search, StopCircle } from 'lucide-react';
import { BootReconciliationModal } from '../components/BootReconciliationModal';
import { DeaconPauseToggle } from '../components/DeaconPauseToggle';
import { LowCostModePill } from '../components/LowCostModePill';
import { SystemMenu } from '../components/SystemMenu';
import { StoppedAgentsBanner } from '../components/StoppedAgentsBanner';
import { OrphanTestAgentsSurface } from '../components/OrphanTestAgentsSurface';
import { CodexAuthBanner } from '../components/CodexAuthBanner';
import { SystemHealthPill } from '../components/SystemHealthPill';
import { triggerEmergencyStop, EMERGENCY_STOP_HOTKEY_LABEL } from '../components/EmergencyStopOverlay';
import type { Tab } from '../components/Header';
import type { TrackerStatusItem } from './api';

interface DashboardLifecycleView {
  active: boolean;
  issueId?: string | null;
  reason?: string | null;
}

interface AppChromeProps {
  activeTab: Tab;
  selectedProjectKey: string | null;
  runningAgentCount: number;
  dashboardLifecycle: DashboardLifecycleView;
  showRestartBanner: boolean;
  bannerState: 'down' | 'recovering' | null;
  missingKeyTrackers: TrackerStatusItem[];
  trackerBannerDismissed: boolean;
  showCliproxyBanner: boolean | undefined;
  isRestartBackendPending: boolean;
  isRestartCliproxyPending: boolean;
  isSessionFeedSidebarOpen: boolean;
  onSearchOpen: () => void;
  onOpenSettings: () => void;
  onDismissTrackerBanner: () => void;
  onRestartBackend: () => void;
  onRestartCliproxy: () => void;
  onToggleSessionFeedSidebar: () => void;
}

export function AppChrome({
  activeTab,
  selectedProjectKey,
  runningAgentCount,
  dashboardLifecycle,
  showRestartBanner,
  bannerState,
  missingKeyTrackers,
  trackerBannerDismissed,
  showCliproxyBanner,
  isRestartBackendPending,
  isRestartCliproxyPending,
  isSessionFeedSidebarOpen,
  onSearchOpen,
  onOpenSettings,
  onDismissTrackerBanner,
  onRestartBackend,
  onRestartCliproxy,
  onToggleSessionFeedSidebar,
}: AppChromeProps) {
  return (
    <>
      <BootReconciliationModal />

      {/* Deacon-frozen state and stopped-agents are now compact pills in the
          app bar (PAN-1591), not persistent full-width banners. */}
      <OrphanTestAgentsSurface />

      {/* Codex Auth Banner — shown when Codex OAuth tokens are expired/burned */}
      <CodexAuthBanner />

      {/* Dashboard Restart Banner — shown during a planned restart (post-merge deploy, pan restart) */}
      {showRestartBanner && (
        <div className="bg-primary/15 border-b-2 border-primary/40 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
          <RefreshCw className="w-5 h-5 text-primary shrink-0 animate-spin" />
          <p className="text-primary text-sm font-semibold flex-1">
            Dashboard is restarting
            {dashboardLifecycle.issueId && (
              <> — <span className="font-mono">{dashboardLifecycle.issueId}</span></>
            )}
            {dashboardLifecycle.reason && (
              <span className="font-normal ml-1 text-primary/70">({dashboardLifecycle.reason})</span>
            )}
          </p>
          <span className="text-primary/60 text-xs shrink-0 animate-pulse">● Restarting…</span>
        </div>
      )}

      {/* Backend Offline Banner — shown when /api/version fails repeatedly AND not in a planned restart */}
      {bannerState === 'down' && !showRestartBanner && (
        <div className="bg-destructive/15 border-b-2 border-destructive/50 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-destructive text-sm font-semibold flex-1">
            Backend is unreachable — waiting for it to come back.
          </p>
          <span className="text-destructive/60 text-xs shrink-0 animate-pulse">● Retrying…</span>
          <button
            onClick={onRestartBackend}
            disabled={isRestartBackendPending}
            className="px-4 py-1.5 bg-destructive/20 hover:bg-destructive/30 text-destructive text-sm font-bold rounded-md border border-destructive/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isRestartBackendPending ? 'Restarting…' : 'Force Restart'}
          </button>
        </div>
      )}

      {/* Backend Recovered Banner — yellow confirmation, auto-hides */}
      {bannerState === 'recovering' && !showRestartBanner && (
        <div className="bg-warning/15 border-b-2 border-warning/50 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
          <CheckCircle2 className="w-5 h-5 text-warning-foreground shrink-0" />
          <p className="text-warning-foreground text-sm font-semibold flex-1">
            Backend is back up.
          </p>
        </div>
      )}

      {/* Missing Tracker API Key Banner */}
      {missingKeyTrackers.length > 0 && !trackerBannerDismissed && (
        <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-4 h-4 text-warning-foreground shrink-0" />
          <p className="text-warning-foreground text-sm flex-1">
            <span className="font-semibold">Missing API key{missingKeyTrackers.length > 1 ? 's' : ''}:</span>{' '}
            {missingKeyTrackers.map(t => (
              <span key={t.type}>
                {t.name} (<code className="font-mono text-xs bg-warning/20 px-1 rounded">{t.envVar}</code>)
              </span>
            )).reduce((prev, curr, i) => i === 0 ? [curr] : [...prev, ', ', curr], [] as React.ReactNode[])}.{' '}
            <button
              onClick={onOpenSettings}
              className="underline hover:opacity-80 font-semibold"
            >
              Configure in Settings
            </button>
          </p>
          <button
            onClick={onDismissTrackerBanner}
            className="text-warning-foreground/60 hover:text-warning-foreground shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* CLIProxy Down Banner — shown when the GPT subscription sidecar is not running */}
      {showCliproxyBanner && (
        <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
          <p className="text-warning-foreground text-sm font-semibold flex-1">
            CLIProxy is down — GPT subscription agents will fail.
          </p>
          <button
            onClick={onRestartCliproxy}
            disabled={isRestartCliproxyPending}
            className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isRestartCliproxyPending ? 'Restarting…' : 'Restart CLIProxy'}
          </button>
        </div>
      )}

      {/* App bar (PAN-1591) — project crumb · centered search · status pills.
          Replaces the persistent deacon/mem chrome with a compact strip. */}
      <div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        {/* left: active-project crumb */}
        <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
          {selectedProjectKey ? (
            <>
              <span className="h-3.5 w-3.5 rounded-[4px] bg-primary/40" aria-hidden="true" />
              {selectedProjectKey}
            </>
          ) : (
            <span className="text-muted-foreground">All projects</span>
          )}
        </div>

        {/* center: search (project-scoped placeholder — wired to global search today) */}
        <button
          type="button"
          onClick={onSearchOpen}
          className="mx-auto flex w-full min-w-0 max-w-md items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          title="Search"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedProjectKey ? `Search ${selectedProjectKey}…` : 'Search issues, conversations, commands…'}</span>
          <kbd className="ml-auto rounded border border-border px-1.5 text-[11px]">/</kbd>
        </button>

        {/* right: status pills */}
        <div className="flex shrink-0 items-center gap-2">
          <DeaconPauseToggle compact />
          {runningAgentCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{runningAgentCount} agent{runningAgentCount === 1 ? '' : 's'}
            </span>
          )}
          {runningAgentCount > 0 && (
            <button
              type="button"
              onClick={triggerEmergencyStop}
              title={`Emergency stop — kill all agents and freeze auto-resume (${EMERGENCY_STOP_HOTKEY_LABEL})`}
              aria-label="Emergency stop all agents"
              className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
            >
              <StopCircle className="h-3.5 w-3.5" /> Stop all
            </button>
          )}
          <StoppedAgentsBanner variant="pill" />
          <LowCostModePill onOpenSettings={onOpenSettings} />
          <SystemHealthPill />
          <SystemMenu onOpenSettings={onOpenSettings} />
          {/* The Command Deck has the always-on Awareness rail, so the global
              feed toggle only appears on other pages (PAN-1591). */}
          {activeTab !== 'command-deck' && (
            <button
              type="button"
              aria-label="Toggle activity feed"
              aria-pressed={isSessionFeedSidebarOpen}
              title="Activity Feed"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={onToggleSessionFeedSidebar}
            >
              <History className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

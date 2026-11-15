import { AlertTriangle, Moon, Search, Sun } from 'lucide-react';
import { DeaconFrozenChip, DeaconPauseToggle } from '../components/DeaconPauseToggle';
import { DegradedModeBanner } from '../components/DegradedModeBanner';
import { NewBuildBanner } from '../components/NewBuildBanner';
import { LowCostModePill } from '../components/LowCostModePill';
import { NeedsYouIndicator } from '../components/flywheel/NeedsYouIndicator';
import { CloisterStatusBar } from '../components/CloisterStatusBar';
import { StoppedAgentsBanner } from '../components/StoppedAgentsBanner';
import { CodexAuthBanner } from '../components/CodexAuthBanner';
import { ConversationSearchBanner } from '../components/ConversationSearchBanner';
import { InotifyPressureBanner } from '../components/InotifyPressureBanner';
import { LinearMcpAuthBanner } from '../components/LinearMcpAuthBanner';
import { RestartApprovalBanner } from '../components/RestartApprovalBanner';
import { GitHubRateLimitBanner } from '../components/GitHubRateLimitBanner';
import { GitHubQuotaSection } from '../components/GitHubQuotaPill';
import { SetupChecklistBanner } from '../components/SetupChecklistBanner';
import { ClaudeCodeUpgradeBanner } from '../components/ClaudeCodeUpgradeBanner';
import { SyncRequiredBanner } from '../components/SyncRequiredBanner';
import { HealthSection, SystemHealthPill } from '../components/SystemHealthPill';
import { StaleBuildChip } from '../components/StaleBuildChip';
import type { Tab } from '../components/Header';
import { useTheme } from '../hooks/useTheme';
import { useOverdeckBusy } from '../hooks/useOverdeckBusy';
import { OverdeckMark } from '../components/OverdeckMark';
import { PALETTE_SEARCH_PLACEHOLDER, paletteKeycap } from './appChromeLabels';
import { AgentsMenu } from './topbar/AgentsMenu';
import { Breadcrumb } from './topbar/Breadcrumb';
import { AddProjectDialogHost } from '../components/project/new/AddProjectDialog';
import type { CreatedProject } from '../components/project/new/projectCreateTypes';
import type { TrackerStatusItem } from './api';

interface DashboardLifecycleView {
  active: boolean;
  issueId?: string | null;
  reason?: string | null;
}

interface AppChromeProps {
  activeTab: Tab;
  selectedProjectKey: string | null;
  dashboardLifecycle: DashboardLifecycleView;
  missingKeyTrackers: TrackerStatusItem[];
  trackerBannerDismissed: boolean;
  showCliproxyBanner: boolean | undefined;
  isRestartBackendPending: boolean;
  isRestartCliproxyPending: boolean;
  /** Open the command palette (the top bar's search box, PAN-5292 E-D15). */
  onPaletteOpen: () => void;
  onOpenSettings: () => void;
  onDismissTrackerBanner: () => void;
  onRestartBackend: () => void;
  onRestartCliproxy: () => void;
  /** A project was added through the Add-project modal this chrome hosts. */
  onProjectCreated: (project: CreatedProject) => void;
  /** The brand cell opens Home (PAN-5293 F-D14). */
  onGoHome: () => void;
}

export function AppChrome({
  activeTab,
  selectedProjectKey,
  dashboardLifecycle,
  missingKeyTrackers,
  trackerBannerDismissed,
  showCliproxyBanner,
  isRestartBackendPending,
  isRestartCliproxyPending,
  onPaletteOpen,
  onOpenSettings,
  onDismissTrackerBanner,
  onRestartBackend,
  onRestartCliproxy,
  onProjectCreated,
  onGoHome,
}: AppChromeProps) {
  return (
    <>
      <AddProjectDialogHost onCreated={onProjectCreated} />
      {/* PAN-2908 C-FRESH: system notices render in ONE slim row instead of
          stacked full-width banners. */}
      <div data-component="system-notices-row" className="flex flex-wrap items-stretch border-b border-border">
        {/* A deploy script, `pan reload`, or `pan restart` is blocked waiting
            for the operator to approve a dashboard restart (PAN-3729) */}
        <RestartApprovalBanner />

        {/* GitHub calls are paused after a rate-limit refusal (PAN-4264) */}
        <GitHubRateLimitBanner />

        {/* Setup checklist — shown while a required host tool (tmux, git, node,
            claude) is missing from the server's PATH (PAN-774). Hidden on the
            Home tab, which shows the "Get set up" card instead (PAN-4282). */}
        <SetupChecklistBanner activeTab={activeTab} />

        {/* Claude Code launch binary is older than a configured model's minimum (PAN-4359) */}
        <ClaudeCodeUpgradeBanner />

        {/* Package/context inputs changed since the last pan sync. */}
        <SyncRequiredBanner />

        {/* Codex Auth Banner — shown when Codex OAuth tokens are expired/burned */}
        <CodexAuthBanner />

        {/* Conversation Search Banner — shown when transcript indexing/palette
            search cannot run (no API key, out of credits, quota, network) */}
        <ConversationSearchBanner onOpenSettings={onOpenSettings} />

        {/* inotify file-watcher budget nearly exhausted — new dev servers
            would fail with ENOSPC (PAN-3063) */}
        <InotifyPressureBanner />

        {/* Linear MCP Auth Banner — shown when agents are blocked on Linear OAuth (PAN-2997) */}
        <LinearMcpAuthBanner />
      </div>

      {/* Degraded mode (PAN-4279) — the one outage indicator: restarting,
          unreachable, delayed live updates, then a brief "Reconnected". */}
      <DegradedModeBanner
        lifecycle={dashboardLifecycle}
        onRestartBackend={onRestartBackend}
        isRestartBackendPending={isRestartBackendPending}
      />

      {/* PAN-5236: this tab runs older frontend code than the server — offer Reload. */}
      <NewBuildBanner />

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

      {/* App bar (PAN-5292) — crumb · search box (opens the palette) · agents
          menu, Needs you, exception chips, health dot, theme. AppChrome calls no
          store selector: every count lives in its own leaf component (E-D1). */}
      <div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <BrandHome onGoHome={onGoHome} />
        <Breadcrumb activeTab={activeTab} selectedProjectKey={selectedProjectKey} />

        <button
          type="button"
          onClick={onPaletteOpen}
          className="mx-auto flex w-full min-w-0 max-w-md items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          title="Search"
          data-testid="topbar-search"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{PALETTE_SEARCH_PLACEHOLDER}</span>
          <kbd className="ml-auto shrink-0 rounded border border-border px-1.5 text-[11px]">{paletteKeycap()}</kbd>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <AgentsMenu />
          <NeedsYouIndicator />
          {/* Exception chips: each renders only while its condition is true (E-D9). */}
          <DeaconFrozenChip />
          <StoppedAgentsBanner variant="pill" />
          <LowCostModePill onOpenSettings={onOpenSettings} />
          <StaleBuildChip />
          <SystemHealthPill>
            <GitHubQuotaSection />
            <HealthSection title="Auto-resume"><DeaconPauseToggle /></HealthSection>
            <StoppedAgentsBanner variant="section" />
            <HealthSection title="System controls"><CloisterStatusBar onOpenSettings={onOpenSettings} /></HealthSection>
          </SystemHealthPill>
          <ThemeToggleButton />
        </div>
      </div>
    </>
  );
}

/** PAN-5293 F-D14: the brand at the left of the app bar; the mark orbits while Overdeck is busy. */
function BrandHome({ onGoHome }: { onGoHome: () => void }) {
  const busy = useOverdeckBusy();
  return (
    <button
      type="button"
      onClick={onGoHome}
      title="Go to Home"
      data-testid="topbar-brand"
      className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 transition-opacity hover:opacity-80"
    >
      <OverdeckMark className="h-5 w-5 shrink-0 text-primary" orbiting={busy} />
      <span className="font-display text-base font-semibold text-foreground">Overdeck</span>
    </button>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="topbar-theme"
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

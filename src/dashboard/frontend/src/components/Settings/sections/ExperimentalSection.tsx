import { type QueryClient } from '@tanstack/react-query';
import { Beaker, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { type SaveStatus } from '../hooks/useAutosavePipeline';
import { type SettingsConfig } from '../types';

interface ExperimentalSectionProps {
  formData: SettingsConfig;
  queryClient: QueryClient;
  reloadingTldr: boolean;
  saveStatus: SaveStatus;
  setLegacyImportOpen: (open: boolean) => void;
  setReloadingTldr: (reloading: boolean) => void;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function ExperimentalSection({
  formData,
  queryClient,
  reloadingTldr,
  saveStatus,
  setLegacyImportOpen,
  setReloadingTldr,
  onSettingsChange,
}: ExperimentalSectionProps) {
  const handleClaudeCodeChannelsToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      experimental: {
        ...formData.experimental,
        claudeCodeChannels: enabled,
      },
    });
  };

  const handleExperimentalFeaturesToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      experimental: {
        ...formData.experimental,
        experimentalFeatures: enabled,
      },
    });
  };

  const handleStreamdownToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      experimental: {
        ...formData.experimental,
        streamdownRenderer: enabled,
      },
    });
  };

  const handleHarnessModelPermutationsToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      experimental: {
        ...formData.experimental,
        showHarnessModelPermutations: enabled,
      },
    });
  };

  const handleRtkToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      agents: {
        ...formData.agents,
        rtk: {
          ...formData.agents?.rtk,
          enabled,
        },
      },
    });
  };

  const handleTldrToggle = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      agents: {
        ...formData.agents,
        tldr: {
          ...formData.agents?.tldr,
          enabled,
        },
      },
    });
  };

  return (
    <section
      id="experimental"
      data-testid="experimental-section"
      aria-label="Experimental"
      className="py-6 scroll-mt-4 border-t border-warning/30 mt-4"
    >
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Beaker className="w-4 h-4 text-warning" />
        Experimental
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Research-preview features that may change or be removed without notice.
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Experimental features</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Show experimental dashboard surfaces in the sidebar: Agents, AutoPreso, Resources, Activity, Sessions, Metrics, Costs, Health, Skills, and God View.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.experimental?.experimentalFeatures)}
            aria-label="Show experimental dashboard features"
            data-testid="experimental-features-toggle"
            onClick={() => handleExperimentalFeaturesToggle(!formData.experimental?.experimentalFeatures)}
            disabled={saveStatus === 'saving'}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.experimental?.experimentalFeatures ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.experimental?.experimentalFeatures ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">RTK Bash compression</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Filters Bash command outputs through rtk-ai/rtk to reduce token consumption. Opt-in.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.agents?.rtk?.enabled)}
            aria-label="Enable RTK Bash compression"
            data-testid="experimental-rtk-toggle"
            onClick={() => handleRtkToggle(!formData.agents?.rtk?.enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.agents?.rtk?.enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.agents?.rtk?.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">TLDR code-aware reads</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Replaces large code-file reads with structured TLDR summaries to save 90–95% of context tokens.
              Defaults on. Takes effect immediately for new reads — no agent restart needed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="tldr-reload-daemons"
              title="Restart the TLDR index daemons so the daemon layer matches the toggle. Read-interception already updates live on the next read."
              onClick={async () => {
                setReloadingTldr(true);
                try {
                  const res = await fetch('/api/services/tldr/reload', { method: 'POST' });
                  if (!res.ok) throw new Error(await res.text());
                  const body = await res.json();
                  const verb = body.enabled ? `restarted ${body.restarted}` : `stopped ${body.stopped}`;
                  toast.success(`TLDR daemons reloaded (${verb})`);
                  queryClient.invalidateQueries({ queryKey: ['tldr-status'] });
                } catch (err: any) {
                  toast.error(`Failed to reload TLDR daemons: ${err.message}`);
                } finally {
                  setReloadingTldr(false);
                }
              }}
              disabled={reloadingTldr}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:border-primary/50 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {reloadingTldr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {reloadingTldr ? 'Reloading…' : 'Reload daemons'}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={formData.agents?.tldr?.enabled ?? true}
              aria-label="Enable TLDR code-aware reads"
              data-testid="experimental-tldr-toggle"
              onClick={() => handleTldrToggle(!(formData.agents?.tldr?.enabled ?? true))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                (formData.agents?.tldr?.enabled ?? true) ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                (formData.agents?.tldr?.enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Claude Code Channels</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use Channels transport for conversation delivery; work-agent MCP wiring is YAML-only
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.experimental?.claudeCodeChannels)}
            aria-label="Use Claude Code Channels for prompt delivery (work agents only)"
            data-testid="experimental-claude-code-channels-toggle"
            onClick={() => handleClaudeCodeChannelsToggle(!formData.experimental?.claudeCodeChannels)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.experimental?.claudeCodeChannels ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.experimental?.claudeCodeChannels ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Streamdown renderer</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Render chat markdown with Streamdown — research preview
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.experimental?.streamdownRenderer)}
            aria-label="Render chat markdown with Streamdown"
            data-testid="experimental-streamdown-toggle"
            onClick={() => handleStreamdownToggle(!formData.experimental?.streamdownRenderer)}
            disabled={saveStatus === 'saving'}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.experimental?.streamdownRenderer ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.experimental?.streamdownRenderer ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Import conversations from old Panopticon</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Migrate conversations from your pre-rebrand <span className="font-mono">~/.panopticon/panopticon.db</span> into
              Overdeck. Titles, cost history, favorites, and JSONL transcript links are preserved.
              Existing conversations are never overwritten.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLegacyImportOpen(true)}
            data-testid="legacy-import-open-button"
            className="shrink-0 px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors"
          >
            Import…
          </button>
        </div>
      </div>
    </section>
  );
}

import { Beaker } from 'lucide-react';
import { type SaveStatus } from '../hooks/useAutosavePipeline';
import { type SettingsConfig } from '../types';

interface ExperimentalSectionProps {
  formData: SettingsConfig;
  saveStatus: SaveStatus;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function ExperimentalSection({
  formData,
  saveStatus,
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
      </div>
    </section>
  );
}

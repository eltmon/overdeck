import { Activity } from 'lucide-react';
import type { SaveStatus } from '../hooks/useAutosavePipeline';
import type { SettingsConfig } from '../types';

interface TelemetrySectionProps {
  formData: SettingsConfig;
  saveStatus: SaveStatus;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

function shortInstallId(installId: string | undefined): string {
  if (!installId) return 'Unavailable';
  return `${installId.slice(0, 8)}…${installId.slice(-4)}`;
}

export function TelemetrySection({ formData, saveStatus, onSettingsChange }: TelemetrySectionProps) {
  const enabled = formData.telemetry?.enabled !== false;
  const toggle = () => {
    onSettingsChange({
      ...formData,
      telemetry: {
        ...formData.telemetry,
        enabled: !enabled,
      },
    });
  };

  return (
    <section id="telemetry" data-testid="telemetry-section" aria-label="Telemetry" className="py-6 scroll-mt-4 border-t border-border mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Activity className="w-4 h-4 text-muted-foreground" />
        Telemetry
      </h2>

      <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-border bg-card/30">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">Share anonymous usage data</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Help improve Overdeck by sharing product usage and error diagnostics without project content.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Share anonymous usage data"
          data-testid="telemetry-enabled-toggle"
          onClick={toggle}
          disabled={saveStatus === 'saving'}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`} />
        </button>
      </div>

      <p className="px-4 mt-3 text-xs text-muted-foreground" data-testid="telemetry-status">
        {enabled ? 'Enabled' : 'Disabled'} · Install ID {shortInstallId(formData.telemetry?.installId)}
      </p>

      <div className="grid gap-4 md:grid-cols-2 mt-5 px-4">
        <div className={`transition-opacity ${enabled ? 'opacity-100' : 'opacity-45'}`} data-testid="telemetry-sent-list">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">What&apos;s sent</h3>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
            <li>Feature usage and pipeline stage events</li>
            <li>Bucketed counts, durations, model families, and harnesses</li>
            <li>App version, operating system, architecture, and error diagnostics</li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Never sent</h3>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
            <li>Source code, prompts, conversation content, or agent output</li>
            <li>Issue titles, descriptions, identifiers, repository names, or file paths</li>
            <li>API keys, tokens, or credentials from Overdeck or other tools</li>
          </ul>
        </div>
      </div>

      <div className="mt-5 mx-4 border-t border-border pt-4 text-xs text-muted-foreground space-y-2">
        <p>Equivalent configuration:</p>
        <div className="grid gap-2 sm:grid-cols-2 font-mono text-[11px]">
          <pre className="rounded-md border border-border bg-muted/30 px-3 py-2 whitespace-pre-wrap">{`telemetry:\n  enabled: ${enabled ? 'true' : 'false'}`}</pre>
          <code className="rounded-md border border-border bg-muted/30 px-3 py-2">OVERDECK_TELEMETRY={enabled ? '1' : '0'}</code>
        </div>
        <p>Changes apply on the next dashboard load. The environment variable can only force telemetry off.</p>
      </div>
    </section>
  );
}

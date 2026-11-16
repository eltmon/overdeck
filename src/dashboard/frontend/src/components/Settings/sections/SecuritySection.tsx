/**
 * Settings → Security (PAN-4594): the `security.semgrep` controls, backed by the
 * path-scoped settings door (`GET`/`PUT /api/semgrep/settings`), plus the managed
 * install button (`POST /api/prereqs/install`). Self-contained, like
 * `MergeTrainBatchingSection`.
 */
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { SettingsRow } from '../primitives';
import { useSemgrepSettings } from '../hooks/useSemgrepSettings';

function Switch({ checked, disabled, label, testId, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  testId: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}

function ConfigsField({ value, disabled, onSave, onError }: {
  value: string[] | undefined;
  disabled: boolean;
  onSave: (next: string[]) => void;
  onError: (message: string | null) => void;
}) {
  const [lastValue, setLastValue] = useState(value);
  const [draft, setDraft] = useState((value ?? []).join('\n'));
  if (value !== lastValue) {
    setLastValue(value);
    setDraft((value ?? []).join('\n'));
  }
  const commit = () => {
    const next = draft.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    if (next.length === 0) {
      onError('Add at least one rule config');
      setDraft((value ?? []).join('\n'));
      return;
    }
    onError(null);
    if (JSON.stringify(next) !== JSON.stringify(value ?? [])) onSave(next);
    setDraft(next.join('\n'));
  };
  return (
    <textarea
      aria-label="Rule configs"
      data-testid="semgrep-configs-input"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      rows={3}
      className="w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
    />
  );
}

function TimeoutField({ value, disabled, onSave, onError }: {
  value: number | undefined;
  disabled: boolean;
  onSave: (next: number) => void;
  onError: (message: string | null) => void;
}) {
  const [lastValue, setLastValue] = useState(value);
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value === undefined ? '' : String(value));
  }
  const commit = () => {
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 1) {
      onError('Timeout must be a whole number of seconds, 1 or more');
      setDraft(value === undefined ? '' : String(value));
      return;
    }
    onError(null);
    if (next !== value) onSave(next);
  };
  return (
    <input
      type="number"
      min={1}
      step={1}
      aria-label="Scan timeout (seconds)"
      data-testid="semgrep-timeout-input"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
    />
  );
}

function installStatusText(enabled: boolean, installed: boolean | undefined, installing: boolean, pinnedVersion: string): string {
  if (!enabled) return 'Turn Semgrep on to install it.';
  if (installing) return 'Installing… this can take several minutes';
  if (installed === true) return `Semgrep ${pinnedVersion} installed`;
  if (installed === false) return 'Not installed';
  return 'Checking install state…';
}

export function SecuritySection() {
  const {
    settings, loadError, save, saving, serverError,
    installed, install, installing, installMessage,
  } = useSemgrepSettings();
  const [clientError, setClientError] = useState<string | null>(null);

  const header = (
    <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
      <ShieldAlert className="w-4 h-4 text-muted-foreground" />
      Security
    </h2>
  );

  if (loadError) {
    return (
      <section id="security" className="py-6 scroll-mt-4">
        {header}
        <div
          data-testid="semgrep-settings-load-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive"
        >
          Fix security.semgrep in ~/.overdeck/config.yaml: {loadError}
        </div>
      </section>
    );
  }

  const enabled = settings?.enabled === true;
  const rowsDisabled = !enabled || saving;
  const installDisabled = !enabled || installing;

  return (
    <section id="security" className="py-6 scroll-mt-4">
      {header}
      <p className="text-xs text-muted-foreground mb-4">
        Opt-in static analysis with a managed Semgrep CLI. Gate, severity, rule configs and timeout
        apply to the next verification run. The MCP server and edit hook apply to agent sessions
        started after the change. Per-project gate overrides are in each project&apos;s Project settings.
      </p>
      <div className="space-y-1">
        <SettingsRow
          label="Semgrep"
          description={enabled ? undefined : 'Off: nothing is installed or run.'}
        >
          <Switch
            checked={enabled}
            disabled={saving}
            label="Enable Semgrep"
            testId="semgrep-enabled-toggle"
            onChange={(next) => save({ enabled: next })}
          />
        </SettingsRow>

        <SettingsRow label="Managed install">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span
                data-testid="semgrep-install-status"
                className={installed === true ? 'text-success text-xs' : 'text-muted-foreground text-xs'}
              >
                {installStatusText(enabled, installed, installing, settings?.pinnedVersion ?? '')}
              </span>
              {installed !== true && (
                <button
                  type="button"
                  data-testid="semgrep-install-button"
                  disabled={installDisabled}
                  onClick={install}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50 hover:bg-muted/30"
                >
                  {installing ? 'Installing… this can take several minutes' : `Install Semgrep ${settings?.pinnedVersion ?? ''}`}
                </button>
              )}
            </div>
            {installMessage && (
              <span data-testid="semgrep-install-message" className="text-muted-foreground text-xs">{installMessage}</span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label="Gate mode">
          <select
            aria-label="Gate mode"
            data-testid="semgrep-gate-select"
            value={settings?.gate ?? 'advisory'}
            disabled={rowsDisabled}
            onChange={(event) => save({ gate: event.target.value as 'off' | 'advisory' | 'blocking' })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          >
            <option value="off">Off</option>
            <option value="advisory">Advisory</option>
            <option value="blocking">Blocking</option>
          </select>
        </SettingsRow>

        <SettingsRow label="Minimum severity">
          <select
            aria-label="Minimum severity"
            data-testid="semgrep-severity-select"
            value={settings?.severity ?? 'ERROR'}
            disabled={rowsDisabled}
            onChange={(event) => save({ severity: event.target.value as 'INFO' | 'WARNING' | 'ERROR' })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          >
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </SettingsRow>

        <SettingsRow label="Rule configs" description="One registry id or rule path per line.">
          <ConfigsField
            value={settings?.configs}
            disabled={rowsDisabled}
            onSave={(configs) => save({ configs })}
            onError={setClientError}
          />
        </SettingsRow>

        <SettingsRow label="Scan timeout (seconds)">
          <TimeoutField
            value={settings?.timeout_seconds}
            disabled={rowsDisabled}
            onSave={(timeout_seconds) => save({ timeout_seconds })}
            onError={setClientError}
          />
        </SettingsRow>

        <SettingsRow label="MCP server for agents">
          <Switch
            checked={settings?.mcp === true}
            disabled={rowsDisabled}
            label="Enable the Semgrep MCP server for agents"
            testId="semgrep-mcp-toggle"
            onChange={(next) => save({ mcp: next })}
          />
        </SettingsRow>

        <SettingsRow label="Post-edit scan hook">
          <Switch
            checked={settings?.edit_hook === true}
            disabled={rowsDisabled}
            label="Enable the post-edit Semgrep scan hook"
            testId="semgrep-edit-hook-toggle"
            onChange={(next) => save({ edit_hook: next })}
          />
        </SettingsRow>
      </div>

      {(serverError || clientError) && (
        <p role="alert" data-testid="semgrep-settings-error" className="text-destructive text-xs mt-2">
          {serverError ?? clientError}
        </p>
      )}
    </section>
  );
}

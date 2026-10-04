import { useEffect, useState } from 'react';
import type { JevRoute, JevSettingsInput, JevSettingsView } from '../types';

const JEV_MODEL_SUGGESTIONS = ['jev-1.13-free', 'jev-1.13', 'jev-1.13.0'];
const JEV_MAX_TIMEOUT_MS = 30_000;

export interface JevSettingsPanelProps {
  settings: JevSettingsView;
  anyJevToggleOn: boolean;
  serverError: string | null;
  onSave: (next: JevSettingsInput, opts?: { debounce?: boolean }) => void;
}

/**
 * Presentational panel for jev.base_url (as a route), jev.model and jev.timeout_ms
 * (PAN-4508). All persistence lives in `useJevSettings` — this component only
 * renders `settings`, runs the client-side rules that block a bad save, and calls
 * `onSave`.
 */
export function JevSettingsPanel({ settings, anyJevToggleOn, serverError, onSave }: JevSettingsPanelProps) {
  const [model, setModel] = useState(settings.model ?? '');
  const [timeoutMsText, setTimeoutMsText] = useState(String(settings.timeoutMs));
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => { setModel(settings.model ?? ''); }, [settings.model]);
  useEffect(() => { setTimeoutMsText(String(settings.timeoutMs)); }, [settings.timeoutMs]);

  const inputClass = 'bg-background border border-border rounded-md px-2 py-1 text-[11px] text-foreground focus:ring-1 focus:ring-primary';

  const commit = (patch: Partial<JevSettingsInput>, opts?: { debounce?: boolean }) => {
    const next: JevSettingsInput = {
      route: settings.route,
      model: settings.model ?? '',
      timeoutMs: settings.timeoutMs,
      ...patch,
    };
    if (!next.model.trim() && anyJevToggleOn) {
      setClientError('jev.model is required while a Jev feature is on');
      return;
    }
    if (!Number.isInteger(next.timeoutMs) || next.timeoutMs < 1 || next.timeoutMs > JEV_MAX_TIMEOUT_MS) {
      setClientError(`jev.timeout_ms must be an integer between 1 and ${JEV_MAX_TIMEOUT_MS}`);
      return;
    }
    setClientError(null);
    if (opts) onSave(next, opts); else onSave(next);
  };

  const errorMessage = clientError ?? serverError;

  return (
    <div data-testid="jev-settings-panel" className="px-4 py-3 rounded-lg bg-muted/30 border border-border space-y-2">
      <div className="flex items-center gap-4">
        <label className="text-xs text-muted-foreground w-16 shrink-0">Route</label>
        <select
          data-testid="jev-route-select"
          value={settings.route}
          onChange={(e) => commit({ route: e.target.value as JevRoute })}
          className={`${inputClass} max-w-[220px]`}
        >
          <option value="zen">OpenCode Zen</option>
          <option value="direct">TypeSafe direct</option>
          {settings.route === 'custom' && <option value="custom">{`Custom: ${settings.baseUrl ?? ''}`}</option>}
        </select>
      </div>
      <div className="flex items-center gap-4">
        <label className="text-xs text-muted-foreground w-16 shrink-0">Model</label>
        <input
          data-testid="jev-model-input"
          type="text"
          list="jev-model-suggestions"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            commit({ model: e.target.value }, { debounce: true });
          }}
          className={`${inputClass} w-48 font-mono`}
        />
        <datalist id="jev-model-suggestions">
          {JEV_MODEL_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </div>
      <div className="flex items-center gap-4">
        <label className="text-xs text-muted-foreground w-16 shrink-0">Timeout</label>
        <input
          data-testid="jev-timeout-input"
          type="number"
          min={1}
          max={JEV_MAX_TIMEOUT_MS}
          value={timeoutMsText}
          onChange={(e) => {
            setTimeoutMsText(e.target.value);
            commit({ timeoutMs: Number(e.target.value) }, { debounce: true });
          }}
          className={`${inputClass} w-24`}
        />
        <span className="text-[11px] text-muted-foreground">ms</span>
      </div>
      {errorMessage && (
        <p data-testid="jev-settings-error" role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Key env fallback: {settings.apiKeyRef}</p>
    </div>
  );
}

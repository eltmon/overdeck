import { Brain } from 'lucide-react';
import { type SettingsConfig } from '../types';

interface MemorySectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function MemorySection({ formData, onSettingsChange }: MemorySectionProps) {
  const updateMemorySettings = (memory: NonNullable<SettingsConfig['memory']>, opts: { debounce?: boolean } = {}) => {
    onSettingsChange({
      ...formData,
      memory: {
        ...formData.memory,
        ...memory,
      },
    }, opts);
  };

  const handleMemoryNumberChange = (
    key: 'per_day_cost_cap_usd' | 'rollup_pending_threshold' | 'sidebar_refresh_interval_ms' | 'worker_concurrency',
    value: string,
  ) => {
    updateMemorySettings({ [key]: value === '' ? undefined : Number(value) }, { debounce: true });
  };

  return (
    <section id="memory" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Brain className="w-4 h-4 text-muted-foreground" />
        Memory
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Configure durable memory extraction, prompt-time retrieval, rollups, and activity refresh behavior.
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Extraction provider</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              OVERDECK_MEMORY_PROVIDER and OVERDECK_MEMORY_MODEL override these UI values.
            </p>
          </div>
          <select
            value={formData.memory?.provider || 'anthropic'}
            onChange={(e) => updateMemorySettings({ provider: e.target.value as 'anthropic' | 'cliproxy' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="anthropic">Anthropic</option>
            <option value="cliproxy">cliproxy</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Extraction model</span>
            <p className="text-xs text-muted-foreground mt-0.5">Used for observations, query expansion, and status rollups unless env vars override it</p>
          </div>
          <input
            type="text"
            value={formData.memory?.model || ''}
            onChange={(e) => updateMemorySettings({ model: e.target.value || undefined }, { debounce: true })}
            placeholder={formData.memory?.provider === 'cliproxy' ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001'}
            className="w-64 bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Fallback provider</span>
            <p className="text-xs text-muted-foreground mt-0.5">Optional single fallback target when the primary provider fails</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={formData.memory?.fallback_provider || ''}
              onChange={(e) => updateMemorySettings({ fallback_provider: e.target.value as 'anthropic' | 'cliproxy' | '' })}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="">None</option>
              <option value="anthropic">Anthropic</option>
              <option value="cliproxy">cliproxy</option>
            </select>
            <input
              type="text"
              value={formData.memory?.fallback_model || ''}
              onChange={(e) => updateMemorySettings({ fallback_model: e.target.value || undefined }, { debounce: true })}
              placeholder="fallback model"
              className="w-44 bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Daily cost cap</span>
            <p className="text-xs text-muted-foreground mt-0.5">USD per project per day; 0 disables the cap</p>
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={formData.memory?.per_day_cost_cap_usd ?? 5}
            onChange={(e) => handleMemoryNumberChange('per_day_cost_cap_usd', e.target.value)}
            className="w-28 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Disable observations</span>
            <p className="text-xs text-muted-foreground mt-0.5">Stops hook and poller memory registration on the next settings read, no restart required</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!(formData.memory?.observations_enabled ?? true)}
            aria-label="Disable memory observations"
            onClick={() => updateMemorySettings({ observations_enabled: !(formData.memory?.observations_enabled ?? true) })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              !(formData.memory?.observations_enabled ?? true) ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              !(formData.memory?.observations_enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Prompt-time injection</span>
            <p className="text-xs text-muted-foreground mt-0.5">Retrieve memory on user prompts using query expansion and RAG runs telemetry</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={formData.memory?.prompt_time_injection_enabled ?? true}
            aria-label="Toggle prompt-time memory injection"
            onClick={() => updateMemorySettings({ prompt_time_injection_enabled: !(formData.memory?.prompt_time_injection_enabled ?? true) })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              (formData.memory?.prompt_time_injection_enabled ?? true) ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              (formData.memory?.prompt_time_injection_enabled ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Rollup threshold</span>
            <p className="text-xs text-muted-foreground mt-0.5">Pending turns required before synthesizing workspace status</p>
          </div>
          <input
            type="number"
            min="1"
            step="1"
            value={formData.memory?.rollup_pending_threshold ?? 4}
            onChange={(e) => handleMemoryNumberChange('rollup_pending_threshold', e.target.value)}
            className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Extraction workers</span>
            <p className="text-xs text-muted-foreground mt-0.5">Maximum concurrent memory extractions across all sessions</p>
          </div>
          <input
            type="number"
            min="1"
            step="1"
            value={formData.memory?.worker_concurrency ?? 4}
            onChange={(e) => handleMemoryNumberChange('worker_concurrency', e.target.value)}
            className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Sidebar refresh interval</span>
            <p className="text-xs text-muted-foreground mt-0.5">Milliseconds between activity fallback refreshes</p>
          </div>
          <input
            type="number"
            min="1"
            step="1000"
            value={formData.memory?.sidebar_refresh_interval_ms ?? 10000}
            onChange={(e) => handleMemoryNumberChange('sidebar_refresh_interval_ms', e.target.value)}
            className="w-28 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </section>
  );
}

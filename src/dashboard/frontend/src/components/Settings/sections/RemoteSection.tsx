import { Globe } from 'lucide-react';
import { type SettingsConfig } from '../types';

interface RemoteSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function RemoteSection({ formData, onSettingsChange }: RemoteSectionProps) {
  const handleRemoteResiliencyTierChange = (tier: 'ephemeral' | 'durable') => {
    onSettingsChange({
      ...formData,
      remote: {
        ...formData.remote,
        resiliency_tier: tier,
      },
    });
  };

  const handleRemoteMaxConcurrentAgentsChange = (value: string) => {
    const num = value === '' ? undefined : Number(value);
    onSettingsChange({
      ...formData,
      remote: {
        ...formData.remote,
        max_concurrent_agents: num,
      },
    }, { debounce: true });
  };

  return (
    <section id="remote" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Globe className="w-4 h-4 text-muted-foreground" />
        Remote
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Provisioning defaults for Fly.io remote work agents.
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Resiliency tier</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Durable machines keep a persistent workspace volume; ephemeral machines are cheaper but lose state on crash.
            </p>
          </div>
          <select
            value={formData.remote?.resiliency_tier ?? 'ephemeral'}
            onChange={(e) => handleRemoteResiliencyTierChange(e.target.value as 'ephemeral' | 'durable')}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="ephemeral">Ephemeral</option>
            <option value="durable">Durable</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Max concurrent remote agents</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              0 means unlimited.
            </p>
          </div>
          <input
            type="number"
            min="0"
            step="1"
            value={formData.remote?.max_concurrent_agents ?? 0}
            onChange={(e) => handleRemoteMaxConcurrentAgentsChange(e.target.value)}
            className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </section>
  );
}

import { type SettingsConfig } from '../types';

interface TerminalSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function TerminalSection({ formData, onSettingsChange }: TerminalSectionProps) {
  const handleTmuxConfigModeChange = (configMode: 'managed' | 'inherit-user') => {
    onSettingsChange({
      ...formData,
      tmux: {
        ...formData.tmux,
        config_mode: configMode,
      },
    });
  };

  return (
    <section id="terminal" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        Terminal
      </h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">tmux configuration</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(formData.tmux?.config_mode || 'managed') === 'managed'
                ? 'Using Overdeck-managed tmux socket and config'
                : 'Inheriting your user tmux configuration'}
            </p>
          </div>
          <select
            value={formData.tmux?.config_mode || 'managed'}
            onChange={(e) => handleTmuxConfigModeChange(e.target.value as 'managed' | 'inherit-user')}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="managed">Managed</option>
            <option value="inherit-user">Inherit user</option>
          </select>
        </div>
      </div>
    </section>
  );
}

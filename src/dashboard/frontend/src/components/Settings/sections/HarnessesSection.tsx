import { Toggle } from '../Shared/Toggle';
import { type SettingsConfig } from '../types';

interface HarnessesSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

/** PAN-5108: the machine-wide switch for automatic coding-agent CLI updates (`harnesses.auto_update`). */
export function HarnessesSection({ formData, onSettingsChange }: HarnessesSectionProps) {
  return (
    <section id="coding-agents" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">Coding Agents</h2>
      <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">Keep coding-agent CLIs up to date automatically</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Overdeck checks npm-installed CLIs such as Claude Code and Codex two minutes after it starts and then once a day,
            and updates Claude Code when a model needs a newer version. Running sessions keep their current version.
            Turn this off to update them yourself.
          </p>
        </div>
        <Toggle
          checked={formData.harnesses?.auto_update ?? true}
          onChange={(checked) => onSettingsChange({ ...formData, harnesses: { ...formData.harnesses, auto_update: checked } })}
        />
      </div>
    </section>
  );
}

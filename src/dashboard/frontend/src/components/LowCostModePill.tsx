import { useQuery } from '@tanstack/react-query';
import { Gauge, AlertCircle } from 'lucide-react';
import { requestSettingsSection } from '../lib/settingsSection';

/**
 * Low-cost mode pill (PAN-1600).
 *
 * Lives in the always-rendered app bar (not the cloister status bar, which
 * hides itself when its status fetch fails) so the "background AI is off"
 * notification is always visible while low-cost mode is on. Clicking it opens
 * Settings and scrolls to the Background AI section.
 *
 * The exclamation is muted gray, not red: low-cost mode is a deliberately
 * available choice, not an error — but background AI (especially durable
 * memory) is valuable, so we gently flag that it's a less-than-ideal state.
 */

interface LowCostSettings {
  background_ai?: { cheap_mode?: boolean };
}

async function fetchBackgroundAiCheapMode(): Promise<LowCostSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('settings fetch failed');
  return res.json();
}

export function LowCostModePill({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchBackgroundAiCheapMode,
    retry: false,
  });

  if (data?.background_ai?.cheap_mode !== true) return null;

  return (
    <button
      type="button"
      data-testid="low-cost-mode-pill"
      onClick={() => {
        requestSettingsSection('background-ai');
        onOpenSettings?.();
      }}
      title="Background AI (titles, memory, enrichment, narration) is off to save cost. Memory in particular is one of Overdeck's most valuable features — click to choose what runs."
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
      Low-cost mode
      <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
    </button>
  );
}

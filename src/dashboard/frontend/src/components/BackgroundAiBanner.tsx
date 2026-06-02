import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, X } from 'lucide-react';
import type { SettingsConfig } from './Settings/types';

/**
 * Background AI onboarding banner (PAN-1589).
 *
 * Background AI (conversation titles, memory extraction, enrichment, narration,
 * …) is OFF by default (low-cost mode on). This one-time banner explains that
 * and lets the user turn it all on in a click, or open the settings page. It
 * shows only while low-cost mode is on AND the user hasn't been onboarded, so
 * it never nags anyone who has already enabled background AI.
 */

async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export function BackgroundAiBanner({ onConfigure }: { onConfigure: () => void }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const bg = settings?.background_ai;
  const show = bg?.cheap_mode === true && bg?.onboarded !== true;

  // GET-merge-PUT: /api/settings is a full save, so we overlay only the
  // background_ai slice onto the freshest snapshot to avoid clobbering.
  const mutation = useMutation({
    mutationFn: async (patch: { cheap_mode?: boolean; onboarded: boolean }) => {
      const latest = await fetchSettings();
      const next: SettingsConfig = {
        ...latest,
        background_ai: { ...latest.background_ai, ...patch },
      };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to save settings');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (!show) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-sm">
      <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Background AI is off to save cost.</span>{' '}
        <span className="text-muted-foreground">
          Conversation titles, memory, enrichment, and narration are disabled until you opt in.
        </span>
      </div>
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ cheap_mode: false, onboarded: true })}
        className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Turn it all on
      </button>
      <button
        type="button"
        onClick={onConfigure}
        className="shrink-0 rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
      >
        Configure
      </button>
      <button
        type="button"
        aria-label="Keep background AI off"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ onboarded: true })}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

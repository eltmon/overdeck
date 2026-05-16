import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SettingsConfig } from '../components/Settings/types';

async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function putSettings(settings: SettingsConfig): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to update TTS mute setting');
    throw new Error(message || 'Failed to update TTS mute setting');
  }
}

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

export function isIssueTtsMuted(settings: SettingsConfig | undefined, issueId: string): boolean {
  const normalized = normalizeIssueId(issueId);
  if (!normalized) return false;
  return settings?.tts?.mutedIssues?.some((mutedIssue) => normalizeIssueId(mutedIssue) === normalized) ?? false;
}

export function setIssueTtsMuted(settings: SettingsConfig, issueId: string, muted: boolean): SettingsConfig {
  const normalized = normalizeIssueId(issueId);
  const mutedIssues = settings.tts?.mutedIssues ?? [];
  const withoutIssue = mutedIssues.filter((mutedIssue) => normalizeIssueId(mutedIssue) !== normalized);

  return {
    ...settings,
    tts: {
      ...settings.tts,
      mutedIssues: muted && normalized ? [...withoutIssue, normalized] : withoutIssue,
    },
  };
}

export function useTtsIssueMute(issueId: string) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  });
  const muted = isIssueTtsMuted(settingsQuery.data, issueId);

  const mutation = useMutation({
    mutationFn: async (nextMuted: boolean) => {
      const latestSettings = await fetchSettings();
      const nextSettings = setIssueTtsMuted(latestSettings, issueId, nextMuted);
      await putSettings(nextSettings);
      return nextSettings;
    },
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(['settings'], nextSettings);
      toast.success(isIssueTtsMuted(nextSettings, issueId) ? 'TTS muted for this issue' : 'TTS unmuted for this issue');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update TTS mute setting: ${error.message}`);
    },
  });

  return {
    muted,
    loading: settingsQuery.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(!muted),
  };
}

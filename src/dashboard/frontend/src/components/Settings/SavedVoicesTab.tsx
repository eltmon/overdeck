import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../DialogProvider';

export interface TtsVoiceListItem {
  id: string;
  name: string;
  kind: 'preset' | 'design' | 'clone';
  createdAt?: string;
  presetName?: string;
  description?: string;
  instruct?: string;
}

async function fetchTtsVoices(): Promise<TtsVoiceListItem[]> {
  const res = await fetch('/api/tts/voices');
  if (!res.ok) throw new Error('Failed to fetch TTS voices');
  return res.json();
}

async function deleteTtsVoice(id: string): Promise<void> {
  const res = await fetch(`/api/tts/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to delete TTS voice');
    throw new Error(message || 'Failed to delete TTS voice');
  }
}

async function clearTtsVoices(): Promise<void> {
  const res = await fetch('/api/tts/voices', { method: 'DELETE' });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to clear TTS voices');
    throw new Error(message || 'Failed to clear TTS voices');
  }
}

async function requireTtsSpoken(res: Response, fallback: string): Promise<void> {
  const body = await res.json().catch(() => undefined) as { spoken?: unknown; result?: unknown; error?: unknown } | undefined;
  const error = typeof body?.error === 'string' ? body.error : undefined;
  const result = typeof body?.result === 'string' ? body.result : undefined;

  if (!res.ok) throw new Error(error || result || fallback);
  if (body?.spoken !== true) throw new Error(error || (result ? `TTS did not speak (${result})` : fallback));
}

async function playTtsVoice(id: string): Promise<void> {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceId: id, text: 'This is a Panopticon TTS voice test.', preview: true }),
  });
  await requireTtsSpoken(res, 'Failed to play TTS voice');
}

function kindClass(kind: TtsVoiceListItem['kind']): string {
  if (kind === 'preset') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  if (kind === 'design') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
}

function kindLabel(kind: TtsVoiceListItem['kind']): string {
  if (kind === 'preset') return 'Preset';
  if (kind === 'design') return 'Design';
  return 'Clone';
}

export function SavedVoicesTab() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const voicesQuery = useQuery({
    queryKey: ['tts-voices'],
    queryFn: fetchTtsVoices,
    staleTime: 60_000,
  });
  const voices = voicesQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: deleteTtsVoice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tts-voices'] });
      toast.success('Voice deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete voice: ${error.message}`);
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearTtsVoices,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tts-voices'] });
      toast.success('Saved voices cleared');
    },
    onError: (error: Error) => {
      toast.error(`Failed to clear voices: ${error.message}`);
    },
  });

  const playMutation = useMutation({
    mutationFn: playTtsVoice,
    onSuccess: () => toast.success('Voice test sent to TTS daemon'),
    onError: (error: Error) => toast.error(`Failed to play voice: ${error.message}`),
  });

  const handleClearAll = async () => {
    if (voices.length === 0) return;
    const confirmed = await confirm({
      title: 'Clear saved voices?',
      message: `Delete all ${voices.length} saved TTS voice${voices.length === 1 ? '' : 's'}?`,
      variant: 'destructive',
      confirmLabel: 'Clear All',
    });
    if (confirmed) clearMutation.mutate();
  };

  return (
    <div className="mt-6 rounded-xl border border-border/70 bg-card/40 p-4" data-testid="tts-saved-voices-tab">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">My Saved Voices</h3>
          <p className="text-xs text-muted-foreground mt-1">Saved preset, design, and clone voices available to TTS playback.</p>
        </div>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={voices.length === 0 || clearMutation.isPending}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {clearMutation.isPending ? 'Clearing…' : 'Clear All Saved'}
        </button>
      </div>

      {voicesQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading saved voices…
        </div>
      ) : voices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No voices saved yet
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {voices.map((voice) => (
            <article key={voice.id} className="rounded-lg border border-border bg-background/60 p-3" data-testid={`tts-voice-card-${voice.id}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-medium text-foreground" title={voice.name}>{voice.name}</h4>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{voice.presetName || voice.description || voice.instruct || voice.id}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${kindClass(voice.kind)}`}>
                  {kindLabel(voice.kind)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playMutation.mutate(voice.id)}
                  disabled={playMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-popover disabled:opacity-50"
                  data-testid={`tts-voice-play-${voice.id}`}
                >
                  <Play className="h-3.5 w-3.5" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(voice.id)}
                  disabled={deleteMutation.isPending || clearMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  data-testid={`tts-voice-delete-${voice.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

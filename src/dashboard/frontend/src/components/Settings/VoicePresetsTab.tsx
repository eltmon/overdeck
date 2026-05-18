import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_VOICE_DESIGN_TEST_TEXT } from './VoiceDesignTab';

interface VoicePreset {
  id: string;
  name: string;
  gender: 'M' | 'F';
}

const CUSTOM_VOICE_PRESETS: VoicePreset[] = [
  { id: 'Aiden', name: 'Aiden', gender: 'M' },
  { id: 'Dylan', name: 'Dylan', gender: 'M' },
  { id: 'Eric', name: 'Eric', gender: 'M' },
  { id: 'Ono Anna', name: 'Ono Anna', gender: 'F' },
  { id: 'Ryan', name: 'Ryan', gender: 'M' },
  { id: 'Serena', name: 'Serena', gender: 'F' },
  { id: 'Sohee', name: 'Sohee', gender: 'F' },
  { id: 'Uncle Fu', name: 'Uncle Fu', gender: 'M' },
  { id: 'Vivian', name: 'Vivian', gender: 'F' },
];

interface PlayPresetInput {
  presetName: string;
  volume: number;
}

interface SavePresetInput {
  name: string;
  presetName: string;
}

async function playPreset(input: PlayPresetInput): Promise<void> {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: DEFAULT_VOICE_DESIGN_TEST_TEXT,
      voice: input.presetName,
      mode: 'custom',
      volume: input.volume,
    }),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to play TTS preset');
    throw new Error(message || 'Failed to play TTS preset');
  }
}

async function savePreset(input: SavePresetInput): Promise<void> {
  const res = await fetch('/api/tts/voices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      kind: 'preset',
      presetName: input.presetName,
    }),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to save preset voice');
    throw new Error(message || 'Failed to save preset voice');
  }
}

export function VoicePresetsTab() {
  const queryClient = useQueryClient();
  const [selectedPreset, setSelectedPreset] = useState(CUSTOM_VOICE_PRESETS[0].id);
  const [volume, setVolume] = useState(0.8);

  const playMutation = useMutation({
    mutationFn: playPreset,
    onSuccess: (_, input) => toast.success(`${input.presetName} preview sent to TTS daemon`),
    onError: (error: Error) => toast.error(`Failed to play preset: ${error.message}`),
  });

  const playAllMutation = useMutation({
    mutationFn: async () => {
      for (const preset of CUSTOM_VOICE_PRESETS) {
        await playPreset({ presetName: preset.id, volume });
      }
    },
    onSuccess: () => toast.success('All preset previews sent to TTS daemon'),
    onError: (error: Error) => toast.error(`Failed to play all presets: ${error.message}`),
  });

  const saveMutation = useMutation({
    mutationFn: savePreset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tts-voices'] });
      toast.success('Preset voice saved');
    },
    onError: (error: Error) => toast.error(`Failed to save preset: ${error.message}`),
  });

  const selected = CUSTOM_VOICE_PRESETS.find((preset) => preset.id === selectedPreset) ?? CUSTOM_VOICE_PRESETS[0];

  const handleSaveSelected = () => {
    const name = window.prompt('Name this preset voice', `${selected.name} Voice`);
    if (!name?.trim()) return;
    saveMutation.mutate({ name: name.trim(), presetName: selected.id });
  };

  return (
    <div className="rounded-b-xl border border-t-0 border-border/70 bg-card/40 p-4" data-testid="tts-voice-presets-tab">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">CustomVoice Presets</h3>
          <p className="mt-1 text-xs text-muted-foreground">Preview and save built-in Qwen3-TTS CustomVoice presets.</p>
        </div>
        <button
          type="button"
          onClick={() => playAllMutation.mutate()}
          disabled={playAllMutation.isPending || playMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
          data-testid="tts-presets-play-all"
        >
          {playAllMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Play All Presets
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
        <label className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Preview volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-36 accent-primary"
            data-testid="tts-presets-volume"
          />
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(volume * 100)}%</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CUSTOM_VOICE_PRESETS.map((preset) => {
          const isSelected = selectedPreset === preset.id;
          const genderLabel = preset.gender === 'M' ? 'Male voice' : 'Female voice';
          const genderSymbol = preset.gender === 'M' ? '♂' : '♀';
          return (
            <article
              key={preset.id}
              className={`rounded-lg border p-3 transition-colors ${
                isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background/60'
              }`}
              data-testid={`tts-preset-card-${preset.id}`}
            >
              <button
                type="button"
                onClick={() => setSelectedPreset(preset.id)}
                className="mb-3 flex w-full items-center gap-3 text-left"
                aria-pressed={isSelected}
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-popover text-sm font-semibold text-muted-foreground" aria-label={genderLabel}>
                  {genderSymbol}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{preset.name}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{preset.gender}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => playMutation.mutate({ presetName: preset.id, volume })}
                disabled={playMutation.isPending || playAllMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
                data-testid={`tts-preset-play-${preset.id}`}
              >
                <Play className="h-3.5 w-3.5" />
                Play
              </button>
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={handleSaveSelected}
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="tts-preset-save-selected"
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Selected Preset…
        </button>
      </div>
    </div>
  );
}

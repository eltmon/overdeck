import { useMutation } from '@tanstack/react-query';
import { CheckCircle, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { TtsVoiceListItem } from './SavedVoicesTab';

const TEST_TEXT = 'This is the current Panopticon system voice.';

async function requireTtsSpoken(res: Response, fallback: string): Promise<void> {
  const body = await res.json().catch(() => undefined) as { spoken?: unknown; result?: unknown; error?: unknown } | undefined;
  const error = typeof body?.error === 'string' ? body.error : undefined;
  const result = typeof body?.result === 'string' ? body.result : undefined;

  if (!res.ok) throw new Error(error || result || fallback);
  if (body?.spoken !== true) throw new Error(error || (result ? `TTS did not speak (${result})` : fallback));
}

interface TtsSystemVoicePickerProps {
  voices: TtsVoiceListItem[];
  isLoading: boolean;
  systemVoiceId?: string;
  statusVoiceId?: string;
  disabled?: boolean;
  onSetSystemVoice: (voiceId: string) => void;
  onSetStatusVoice: (voiceId: string) => void;
}

async function playVoice(voiceId: string): Promise<void> {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceId, text: TEST_TEXT, preview: true }),
  });
  await requireTtsSpoken(res, 'Failed to play TTS voice');
}

function kindClass(kind: TtsVoiceListItem['kind']): string {
  if (kind === 'preset') return 'border-blue-500/30 bg-blue-500/15 text-blue-300';
  if (kind === 'design') return 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300';
  return 'border-purple-500/30 bg-purple-500/15 text-purple-300';
}

function kindLabel(kind: TtsVoiceListItem['kind']): string {
  if (kind === 'preset') return 'Preset';
  if (kind === 'design') return 'Design';
  return 'Clone';
}

function voiceSubtitle(voice: TtsVoiceListItem): string {
  return voice.presetName || voice.description || voice.instruct || voice.id;
}

export function TtsSystemVoicePicker({
  voices,
  isLoading,
  systemVoiceId,
  statusVoiceId,
  disabled,
  onSetSystemVoice,
  onSetStatusVoice,
}: TtsSystemVoicePickerProps) {
  const playMutation = useMutation({
    mutationFn: playVoice,
    onSuccess: () => toast.success('Voice test sent to TTS daemon'),
    onError: (error: Error) => toast.error(`Failed to play voice: ${error.message}`),
  });

  return (
    <div className="mt-6 rounded-xl border border-border/70 bg-card/40 p-4" data-testid="tts-system-voice-picker">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">System Voice</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the default voice for high-priority TTS and the status voice for routine updates.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading saved voices…
        </div>
      ) : voices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No voices saved yet — add voices in the Voice Library below
        </div>
      ) : (
        <div className="space-y-6">
          <VoiceChoiceSection
            title="System Voice"
            description="Default voice for high-priority activity."
            voices={voices}
            selectedVoiceId={systemVoiceId}
            disabled={disabled}
            playPending={playMutation.isPending}
            onPlay={(voiceId) => playMutation.mutate(voiceId)}
            onSelect={onSetSystemVoice}
            testIdPrefix="tts-system-voice"
          />
          <VoiceChoiceSection
            title="Status Voice"
            description="Routine status narration can use a separate voice."
            voices={voices}
            selectedVoiceId={statusVoiceId}
            disabled={disabled}
            playPending={playMutation.isPending}
            onPlay={(voiceId) => playMutation.mutate(voiceId)}
            onSelect={onSetStatusVoice}
            testIdPrefix="tts-status-voice"
          />
        </div>
      )}
    </div>
  );
}

interface VoiceChoiceSectionProps {
  title: string;
  description: string;
  voices: TtsVoiceListItem[];
  selectedVoiceId?: string;
  disabled?: boolean;
  playPending: boolean;
  testIdPrefix: string;
  onPlay: (voiceId: string) => void;
  onSelect: (voiceId: string) => void;
}

function VoiceChoiceSection({
  title,
  description,
  voices,
  selectedVoiceId,
  disabled,
  playPending,
  testIdPrefix,
  onPlay,
  onSelect,
}: VoiceChoiceSectionProps) {
  return (
    <section>
      <div className="mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {voices.map((voice) => {
          const isSelected = selectedVoiceId === voice.id;
          return (
            <article
              key={voice.id}
              className={`rounded-lg border p-3 transition-colors ${
                isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background/60'
              }`}
              data-testid={`${testIdPrefix}-card-${voice.id}`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h5 className="truncate text-sm font-medium text-foreground" title={voice.name}>{voice.name}</h5>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{voiceSubtitle(voice)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${kindClass(voice.kind)}`}>
                  {kindLabel(voice.kind)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPlay(voice.id)}
                  disabled={playPending}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
                  data-testid={`${testIdPrefix}-play-${voice.id}`}
                >
                  <Play className="h-3.5 w-3.5" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(voice.id)}
                  disabled={disabled || isSelected}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
                  data-testid={`${testIdPrefix}-set-${voice.id}`}
                >
                  {isSelected && <CheckCircle className="h-3.5 w-3.5 text-primary" />}
                  {isSelected ? 'Selected' : `Set as ${title.toLowerCase()}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

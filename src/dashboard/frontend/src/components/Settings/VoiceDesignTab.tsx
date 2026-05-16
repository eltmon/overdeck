import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

export const DEFAULT_VOICE_DESIGN_TEST_TEXT = 'The quick brown fox jumps over the lazy dog. Panopticon dashboard is now online.';

interface PreviewDesignVoiceInput {
  description: string;
  instruct: string;
  text: string;
}

interface SaveDesignVoiceInput {
  name: string;
  description: string;
  instruct: string;
}

async function previewDesignVoice(input: PreviewDesignVoiceInput): Promise<void> {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      voice: input.description,
      instruct: input.instruct,
      mode: 'design',
    }),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to preview design voice');
    throw new Error(message || 'Failed to preview design voice');
  }
}

async function saveDesignVoice(input: SaveDesignVoiceInput): Promise<void> {
  const res = await fetch('/api/tts/voices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      kind: 'design',
      description: input.description,
      instruct: input.instruct,
    }),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to save design voice');
    throw new Error(message || 'Failed to save design voice');
  }
}

export function VoiceDesignTab() {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('A calm, measured female voice with a subtle synthetic quality');
  const [instruct, setInstruct] = useState('Speak clearly and calmly, with concise dashboard narration.');
  const [testText, setTestText] = useState(DEFAULT_VOICE_DESIGN_TEST_TEXT);

  const canSubmit = description.trim().length > 0 && testText.trim().length > 0;

  const previewMutation = useMutation({
    mutationFn: previewDesignVoice,
    onSuccess: () => toast.success('Design voice preview sent to TTS daemon'),
    onError: (error: Error) => toast.error(`Failed to preview design voice: ${error.message}`),
  });

  const saveMutation = useMutation({
    mutationFn: saveDesignVoice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tts-voices'] });
      toast.success('Design voice saved');
    },
    onError: (error: Error) => toast.error(`Failed to save design voice: ${error.message}`),
  });

  const handlePreview = () => {
    if (!canSubmit) return;
    previewMutation.mutate({
      description: description.trim(),
      instruct: instruct.trim(),
      text: testText.trim(),
    });
  };

  const handleSave = () => {
    if (!description.trim()) return;
    const name = window.prompt('Name this design voice');
    if (!name?.trim()) return;
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      instruct: instruct.trim(),
    });
  };

  return (
    <div className="rounded-b-xl border border-t-0 border-border/70 bg-card/40 p-4" data-testid="tts-voice-design-tab">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">VoiceDesign</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Describe a synthetic voice, preview it through Qwen3-TTS, then save the design for TTS playback.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-foreground">Voice description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
            placeholder="A calm, measured female voice with a subtle synthetic quality"
            data-testid="tts-design-description"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-foreground">Instruct prompt</span>
          <textarea
            value={instruct}
            onChange={(e) => setInstruct(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
            placeholder="Speaking style, pacing, and delivery notes"
            data-testid="tts-design-instruct"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-xs font-medium text-foreground">Test text</span>
        <input
          type="text"
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
          data-testid="tts-design-test-text"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!canSubmit || previewMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
          data-testid="tts-design-preview"
        >
          {previewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
          Speak with Design Voice
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!description.trim() || saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="tts-design-save"
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save This Design…
        </button>
      </div>
    </div>
  );
}

/**
 * PAN-2908 · C-SIMPLE — "Talk it through" composer.
 *
 * The old Hand-it-off opened GitHub's new-issue page — a dead end out of the
 * product. This does what the operator actually does: spawns a seeded
 * conversation (model chosen here), where the AI discusses the idea and
 * files the issue only when the operator says it's ready. The issue then
 * lands in "Just filed" on My work, one click from planning.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ModelPicker } from '../chat/ModelPicker';
import { ensureDefaultConversationModel, getDefaultConversationModel } from '../chat/defaultConversationModel';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { PrimaryButton } from './parts';

export interface ConversationSpawn {
  id?: number | string;
  name: string;
  title?: string;
}

export function seedDiscussPrompt(description: string): string {
  return [
    'I want to discuss a possible task with you first — do not file anything yet.',
    '',
    'The task idea, in my words:',
    '"""',
    description.trim(),
    '"""',
    '',
    'Discuss it with me: ask what you need to know, point out what is underspecified or wrong, and help me sharpen it.',
    'Only when I explicitly say it is ready (e.g. "file it"), file it as an issue in the tracker with a good title and body based on our discussion, and give me the issue link (e.g. PAN-1234).',
  ].join('\n');
}

export function TalkItThrough() {
  const [text, setText] = useState('');
  const [model, setModel] = useState(() => getDefaultConversationModel() || 'claude-opus-4-6');
  const [harness, setHarness] = useState<'claude-code' | 'codex'>('claude-code');

  useEffect(() => {
    void ensureDefaultConversationModel().then(() => {
      const preferred = getDefaultConversationModel();
      if (preferred) setModel(preferred);
    });
  }, []);

  const spawn = useMutation({
    mutationFn: async (description: string): Promise<ConversationSpawn> => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness, message: seedDiscussPrompt(description) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to start the conversation (${res.status})`);
      }
      return res.json() as Promise<ConversationSpawn>;
    },
    onSuccess: (conv) => {
      if (conv?.name) {
        // The deck's conversation-first view owns the discussion from here.
        window.history.pushState({}, '', `/conv/${encodeURIComponent(conv.name)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    },
  });

  const submit = () => {
    const description = text.trim();
    if (description) spawn.mutate(description);
  };

  return (
    <div className="mt-4 flex items-center gap-2.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={SIMPLE_STRINGS.home.composerPlaceholder}
        className="h-11 flex-1 rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none focus:border-ring"
        data-testid="talk-it-through-input"
      />
      <ModelPicker value={model} onChange={(id) => setModel(id)} harness={harness} onHarnessChange={(h) => setHarness(h as typeof harness)} />
      <PrimaryButton disabled={!text.trim() || spawn.isPending} onClick={submit}>
        {spawn.isPending ? 'Starting…' : SIMPLE_STRINGS.home.composerButton}
      </PrimaryButton>
    </div>
  );
}

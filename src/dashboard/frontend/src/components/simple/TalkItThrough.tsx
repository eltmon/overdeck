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
import { useMutation, useQuery } from '@tanstack/react-query';
import { ModelPicker } from '../chat/ModelPicker';
import { ensureDefaultConversationModel, getDefaultConversationModel } from '../chat/defaultConversationModel';
import { fetchProjects } from '../CommandDeck/projectsData';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { PrimaryButton } from './parts';

const PROJECT_KEY_STORAGE = 'overdeck:talk-project';

function initialProjectKey(projects: { key: string }[]): string | undefined {
  try {
    const remembered = localStorage.getItem(PROJECT_KEY_STORAGE);
    if (remembered && projects.some((p) => p.key === remembered)) return remembered;
  } catch { /* ignore */ }
  // Inside the deck the URL carries the current project — honor it.
  const match = window.location.pathname.match(/^\/command-deck\/([^/]+)/);
  if (match && projects.some((p) => p.key === match[1])) return match[1];
  return projects[0]?.key;
}

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
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, staleTime: 60_000 });
  const projects = projectsQuery.data ?? [];
  const [projectKey, setProjectKey] = useState<string | undefined>(undefined);
  const effectiveProjectKey = projectKey ?? initialProjectKey(projects);

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
        body: JSON.stringify({ model, harness, projectKey: effectiveProjectKey, message: seedDiscussPrompt(description) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to start the conversation (${res.status})`);
      }
      return res.json() as Promise<ConversationSpawn>;
    },
    onSuccess: (conv) => {
      if (conv?.name) {
        try { if (effectiveProjectKey) localStorage.setItem(PROJECT_KEY_STORAGE, effectiveProjectKey); } catch { /* ignore */ }
        // Hard navigation: the deck loads fresh and selects the new conversation
        // from the route (the synthetic popstate path raced the list refresh).
        window.location.assign(`/conv/${encodeURIComponent(conv.name)}`);
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
      {projects.length > 0 && (
        <select
          value={effectiveProjectKey}
          onChange={(e) => setProjectKey(e.target.value)}
          aria-label="Project for this conversation"
          data-testid="talk-it-through-project"
          className="h-11 max-w-[150px] rounded-xl border border-input bg-card px-2 text-xs text-muted-foreground outline-none focus:border-ring"
        >
          {projects.map((p) => (
            <option key={p.key} value={p.key}>{p.name}</option>
          ))}
        </select>
      )}
      <ModelPicker value={model} onChange={(id) => setModel(id)} harness={harness} onHarnessChange={(h) => setHarness(h as typeof harness)} />
      <PrimaryButton disabled={!text.trim() || spawn.isPending} onClick={submit}>
        {spawn.isPending ? 'Starting…' : SIMPLE_STRINGS.home.composerButton}
      </PrimaryButton>
    </div>
  );
}

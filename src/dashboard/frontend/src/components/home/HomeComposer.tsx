/**
 * PAN-4280 (WI-9) — the Home composer: the "type and go" input mounted on
 * both Simple and Advanced Home. It wraps the existing Launcher with the Home
 * intent order (buildHomeIntents), a project chip (D4), and type-to-focus
 * (useTypeToFocus), and can start an agent conversation, the discuss-first
 * flow (Simple only), or a terminal — none of which need a project.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Launcher } from '../Stage/HomePane/Launcher';
import { dispatchLauncherIntent } from '../Stage/HomePane/launcherActions';
import { buildHomeIntents, seedDiscussPrompt } from './homeComposerIntents';
import { useTypeToFocus } from './useTypeToFocus';
import { HomeComposerProjectChip } from './HomeComposerProjectChip';
import { writePendingTerminal } from './pendingTerminal';
import { ModelPicker, type Harness } from '../chat/ModelPicker';
import { ensureDefaultConversationModel, getDefaultConversationModel } from '../chat/defaultConversationModel';
import { fetchRegisteredProjects, type RegisteredProject } from '../CommandDeck/UnknownProjectState';
import { NO_PROJECT_KEY } from '../CommandDeck/projectsData';
import type { UiMode } from '../../lib/simple/uiMode';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';

const TALK_PROJECT_STORAGE_KEY = 'overdeck:talk-project';
const ADVANCED_PLACEHOLDER = 'Ask an agent, or run a command…';

interface ConversationSpawn {
  name: string;
}

function initialProjectKey(projects: RegisteredProject[]): string | undefined {
  try {
    const remembered = localStorage.getItem(TALK_PROJECT_STORAGE_KEY);
    if (remembered && projects.some((p) => p.key === remembered)) return remembered;
  } catch { /* ignore */ }
  return projects[0]?.key;
}

function isOtherInputFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active) return false;
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return true;
  return active instanceof HTMLElement && active.isContentEditable;
}

export interface HomeComposerProps {
  mode: UiMode;
}

export function HomeComposer({ mode }: HomeComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoFocus] = useState(() => !isOtherInputFocused());
  useTypeToFocus(inputRef);

  const [model, setModel] = useState(getDefaultConversationModel);
  const [harness, setHarness] = useState<Harness>();
  useEffect(() => {
    void ensureDefaultConversationModel().then(() => {
      const preferred = getDefaultConversationModel();
      if (preferred) setModel(preferred);
    });
  }, []);

  const projectsQuery = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60_000,
  });
  const projects = projectsQuery.data ?? [];
  // undefined = no explicit choice yet (fall back to the remembered/first
  // project); null = the user explicitly chose "no project".
  const [projectChoice, setProjectChoice] = useState<string | null | undefined>(undefined);
  const projectKey = projectChoice === undefined ? initialProjectKey(projects) : (projectChoice ?? undefined);

  const prerequisitesQuery = useQuery({
    queryKey: ['prerequisites'],
    queryFn: async () => {
      const res = await fetch('/api/prerequisites');
      if (!res.ok) throw new Error('Failed to fetch prerequisites');
      return res.json() as Promise<{ checks: { id: string; found: boolean }[] }>;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const codexAvailable = prerequisitesQuery.data?.checks?.find((c) => c.id === 'codex')?.found === true;

  const intents = useMemo(
    () => buildHomeIntents({ mode, harness, codexAvailable }),
    [mode, harness, codexAvailable],
  );

  const rememberProjectChoice = (key: string | undefined) => {
    try {
      if (key) localStorage.setItem(TALK_PROJECT_STORAGE_KEY, key);
      else localStorage.removeItem(TALK_PROJECT_STORAGE_KEY);
    } catch { /* ignore */ }
  };

  const spawn = useMutation({
    mutationFn: async (params: { message: string; codex: boolean }): Promise<ConversationSpawn> => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          harness: params.codex ? 'codex' : harness,
          message: params.message,
          ...(projectKey ? { projectKey } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to start the conversation (${res.status})`);
      }
      return res.json() as Promise<ConversationSpawn>;
    },
    onSuccess: (conv) => {
      rememberProjectChoice(projectKey);
      window.location.assign(`/conv/${encodeURIComponent(conv.name)}`);
    },
  });

  const openAgent = (intentId: string, query: string) => {
    const message = query.trim();
    if (!message || !model || spawn.isPending) return;
    spawn.mutate({ message, codex: intentId === 'codex' });
  };

  const openTalk = (query: string) => {
    const message = query.trim();
    if (!message || !model || spawn.isPending) return;
    spawn.mutate({ message: seedDiscussPrompt(message), codex: false });
  };

  const openTerminal = (query: string) => {
    const deckKey = projectKey ?? NO_PROJECT_KEY;
    writePendingTerminal({ deckKey, command: query.trim() });
    window.location.assign(`/command-deck/${encodeURIComponent(deckKey)}`);
  };

  const placeholder = mode === 'simple' ? SIMPLE_STRINGS.home.composerPlaceholder : ADVANCED_PLACEHOLDER;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <Launcher
          intents={intents}
          inputRef={inputRef}
          autoFocus={autoFocus}
          inputTestId="home-composer-input"
          placeholder={placeholder}
          busy={spawn.isPending}
          errorText={spawn.error?.message}
          onSelect={(intent, query) =>
            dispatchLauncherIntent(intent, query, {
              openAgent: (i, q) => openAgent(i.id, q),
              openTerminal,
              openWeb: () => {},
              openTalk,
            })
          }
        />
      </div>
      <HomeComposerProjectChip
        mode={mode}
        projects={projects}
        value={projectKey}
        onChange={(key) => setProjectChoice(key ?? null)}
        disabled={spawn.isPending}
      />
      <div className="min-w-0 max-w-full">
        <ModelPicker value={model} onChange={setModel} harness={harness} onHarnessChange={setHarness} followProviderDefault disabled={spawn.isPending} />
      </div>
    </div>
  );
}

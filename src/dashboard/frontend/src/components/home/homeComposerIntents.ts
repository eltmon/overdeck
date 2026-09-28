/**
 * PAN-4280 — Home composer intent order and the discuss-first seed prompt.
 *
 * `buildHomeIntents` implements decision D2's fixed row order for both Homes;
 * `seedDiscussPrompt` moved here verbatim from `components/simple/TalkItThrough.tsx`,
 * which now just re-exports it (D8).
 */
import type { Harness } from '../chat/ModelPicker';
import type { LauncherIntent } from '../Stage/HomePane/Launcher';
import type { UiMode } from '../../lib/simple/uiMode';

export const HOME_AGENT_LABELS: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  ohmypi: 'oh-my-pi',
  codex: 'Codex',
  acp: 'ACP',
  opencode: 'OpenCode',
  'kimi-code': 'Kimi Code',
  muse: 'Muse Code',
};

export function buildHomeIntents(opts: {
  mode: UiMode;
  harness?: Harness;
  codexAvailable: boolean;
}): LauncherIntent[] {
  const { mode, harness, codexAvailable } = opts;

  const intents: LauncherIntent[] = [
    harness
      ? { id: harness, kind: 'agent', agentName: HOME_AGENT_LABELS[harness], keys: '↵' }
      : { id: 'agent', kind: 'agent', keys: '↵' },
    { id: 'terminal', kind: 'terminal', keys: '⌃↵' },
  ];

  if (codexAvailable && harness !== 'codex') {
    intents.push({ id: 'codex', kind: 'agent', agentName: 'Codex', keys: '⌘⇧↵' });
  }

  if (mode === 'simple') {
    intents.push({ id: 'talk', kind: 'talk' });
  }

  return intents;
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

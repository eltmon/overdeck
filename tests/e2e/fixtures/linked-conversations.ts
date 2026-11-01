/**
 * PAN-4650 WI-21 harness: renders a conversation title bar in one machine
 * state with the real components (state chip, Preview + Pull here, machine
 * banner, read-only composer), the real command-deck CSS module and the real
 * theme tokens from index.css. The spec loads it at
 * `/linked-harness?state=<state>&theme=<ledger|broadsheet>&mode=<light|dark>`.
 * Network calls are stubbed: the components only read the conversation row.
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '../../../src/dashboard/frontend/src/index.css';
import styles from '../../../src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css';
import type { Conversation } from '../../../src/dashboard/frontend/src/components/CommandDeck/ConversationList';
import {
  ConversationMachineBanner,
  ConversationMachineChip,
  conversationMachineState,
  MachineReadOnlyNotice,
  RemoteHeaderActions,
} from '../../../src/dashboard/frontend/src/components/chat/ConversationMachineBanner';

export const STATES = ['local', 'remote', 'offline-saved', 'offline-none', 'released'] as const;
export type HarnessState = (typeof STATES)[number];

const BASE = {
  tmuxSession: 'conv-x', status: 'active', cwd: '/home/desk/overdeck/workspaces/feature-pan-4650', issueId: 'PAN-4650',
  createdAt: '2026-11-01T10:00:00.000Z', endedAt: null, lastAttachedAt: null, sessionAlive: true, title: 'Fix the deploy pipeline',
  model: 'claude-opus-5-5', pullable: true, isWorking: false,
};

const LINKED = {
  ...BASE, id: -4, name: '@env-desk/conv-x', origin: 'linked', environmentId: 'env-desk', remoteName: 'conv-x', machineLabel: 'desk',
  machineLastSeenAt: '2026-11-01T11:48:00.000Z', releasedTo: null,
};

/** One conversation row per title-bar state. */
export function conversationFor(state: HarnessState): Conversation {
  switch (state) {
    case 'local': return { ...BASE, id: 12, name: 'conv-x', origin: 'local' } as Conversation;
    case 'remote': return { ...LINKED, machineState: 'online', savedCopyName: null } as Conversation;
    case 'offline-saved': return { ...LINKED, machineState: 'offline', savedCopyName: 'vault-1', savedCopyAt: '2026-11-01T14:02:00.000Z' } as Conversation;
    case 'offline-none': return { ...LINKED, machineState: 'offline', savedCopyName: null } as Conversation;
    case 'released': return { ...BASE, id: 12, name: 'conv-x', origin: 'local', releasedTo: 'env-laptop', claudeSessionId: 's-x', sessionAlive: false } as Conversation;
  }
}

/** The linked row the released copy became, so Open there is enabled. */
const CONTINUATION = {
  ...LINKED, name: '@env-laptop/conv-y', environmentId: 'env-laptop', machineLabel: 'laptop', machineState: 'online',
  pulledFrom: { environmentId: 'env-desk', nativeSessionId: 's-x' },
} as unknown as Conversation;

function mount(): void {
  const params = new URLSearchParams(window.location.search);
  const state = (params.get('state') ?? 'local') as HarnessState;
  document.documentElement.dataset.theme = params.get('theme') ?? 'broadsheet';
  document.documentElement.classList.toggle('dark', params.get('mode') === 'dark');
  window.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

  const conversation = conversationFor(state);
  const client = new QueryClient();
  client.setQueryData(['conversations'], [conversation, CONTINUATION]);
  const live = state === 'local' || state === 'remote';

  createRoot(document.getElementById('root')!).render(
    h(QueryClientProvider, { client },
      h('div', { style: { width: 920, background: 'var(--background)', color: 'var(--foreground)' } },
        h('div', {
          className: `${styles.conversationHeaderShell} ${styles.conversationHeaderContainer}`,
          'data-machine-state': conversationMachineState(conversation),
          'data-testid': 'header',
        },
          h('div', { className: styles.conversationHeaderPrimary },
            h('span', { className: styles.conversationTerminalTitle },
              h('span', { className: styles.conversationTerminalTitleText, 'data-testid': 'title' }, conversation.title)),
            h('div', { className: styles.conversationHeaderActions }, h(RemoteHeaderActions, { conversation }))),
          h('div', { className: styles.conversationMetaRow }, h(ConversationMachineChip, { conversation }))),
        h(ConversationMachineBanner, { conversation }),
        h('div', { style: { height: 120 } }),
        live ? h('div', { 'data-testid': 'composer-live' }, 'composer') : h(MachineReadOnlyNotice, { conversation }),
        // A probe painting --card in the same theme scope, for the local-state comparison.
        h('div', { 'data-testid': 'card-probe', style: { background: 'var(--card)', height: 1 } }))),
  );
}

if (typeof document !== 'undefined' && document.getElementById('root')) mount();

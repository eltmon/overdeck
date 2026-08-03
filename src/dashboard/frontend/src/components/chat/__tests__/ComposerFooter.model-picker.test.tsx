import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetComposerStore } from '../../../lib/composerStore';
import { ComposerFooter } from '../ComposerFooter';
import { applyDefaultConversationModel } from '../defaultConversationModel';

vi.mock('lexical', () => ({
  $createParagraphNode: () => ({ append: vi.fn() }),
  $createTextNode: () => ({}),
  $getRoot: () => ({
    append: vi.fn(),
    clear: vi.fn(),
    getTextContent: () => '',
  }),
}));

vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef, disabled }: { editorRef: { current: unknown }; disabled: boolean }) => {
    editorRef.current = {
      focus: vi.fn(),
      read: (callback: () => void) => callback(),
      update: (callback: () => void) => callback(),
    };
    return <textarea aria-label="Composer editor" disabled={disabled} />;
  },
}));

vi.mock('../VoiceWidget', () => ({
  VoiceWidget: () => null,
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: () => null,
  loadStoredEffort: () => 'high',
}));

vi.mock('../ContextWindowMeter', () => ({
  ContextWindowMeter: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const conversation = {
  id: 1,
  name: 'active-conversation',
  tmuxSession: 'conv-active-conversation',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-08-03T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Active Conversation',
  model: 'claude-sonnet-4-6',
  harness: 'claude-code' as const,
  effort: 'high',
};

function installModelPickerFetchMock(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/settings/available-models') {
      return new Response(JSON.stringify({
        anthropic: [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1MTokens: 15 },
        ],
        kimi: [
          { id: 'kimi-k2.6-flash', name: 'Kimi K2.6 Flash', costPer1MTokens: 1 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/settings') {
      return new Response(JSON.stringify({
        models: {
          default_conversation_model: 'claude-sonnet-4-6',
          provider_harnesses: {},
          provider_default_harnesses: {
            anthropic: 'claude-code',
            kimi: 'ohmypi',
          },
        },
        experimental: { showHarnessModelPermutations: false },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/settings/openrouter/models') {
      return new Response(JSON.stringify({ models: [], favorites: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/api/settings/harness-policy')) {
      return new Response(JSON.stringify({ decisions: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

describe('ComposerFooter active conversation model restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetComposerStore();
    applyDefaultConversationModel('claude-sonnet-4-6');
    installModelPickerFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the running conversation model after the real picker catalog resolves', async () => {
    localStorage.setItem('conv-composer-model', 'kimi-k2.6-flash');

    render(<ComposerFooter conversation={conversation} />);

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/settings/harness-policy'));
    });
    expect(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Kimi K2\.6 Flash/i })).not.toBeInTheDocument();
  });
});

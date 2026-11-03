/**
 * PAN-4837 WI-17b: in the phone app the composer shows no model picker and no
 * mic, reads neither the effort default nor the model lists, and still sends;
 * the subagent composer shows a line and polls nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComposerFooter } from '../ComposerFooter';
import { SubagentComposer } from '../SubagentComposer';
import { resetComposerStore } from '../../../lib/composerStore';

const editorState = vi.hoisted(() => ({ text: '' }));

vi.mock('lexical', () => ({
  $createParagraphNode: () => ({ append: vi.fn() }),
  $createTextNode: () => ({}),
  $getRoot: () => ({ append: vi.fn(), clear: () => { editorState.text = ''; }, getTextContent: () => editorState.text }),
}));
vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef, onChange, disabled }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean }) => {
    editorRef.current = { read: (callback: () => void) => callback(), update: (callback: () => void) => callback(), focus: vi.fn() };
    return (
      <textarea
        data-testid="composer-editor"
        disabled={disabled}
        onChange={(event) => {
          editorState.text = event.target.value;
          onChange(event.target.value);
        }}
      />
    );
  },
}));
vi.mock('../VoiceWidget', () => ({ VoiceWidget: () => null }));
vi.mock('../ContextWindowMeter', () => ({ ContextWindowMeter: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

const native = globalThis as { __OVERDECK_NATIVE__?: boolean };

const conversation = {
  id: 1,
  name: 'phone-conv',
  tmuxSession: 'conv-phone-conv',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-11-03T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Phone Conversation',
  model: 'claude-sonnet-4-6',
  harness: 'claude-code' as const,
  effort: null,
};

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

function fetchedUrls(): string[] {
  return vi.mocked(fetch).mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
  native.__OVERDECK_NATIVE__ = true;
  editorState.text = '';
  localStorage.clear();
  resetComposerStore();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/kickoff')) return json({ held: false });
    if (url.endsWith('/scheduled-messages')) return json({ supported: true, limit: null, messages: [] });
    if (url.endsWith('/message')) return json({ ok: true });
    return json({});
  }));
});

afterEach(() => {
  cleanup();
  delete native.__OVERDECK_NATIVE__;
  vi.unstubAllGlobals();
});

describe('ComposerFooter in the phone app (PAN-4837)', () => {
  it('renders no model picker and no mic, reads no admin route, and still sends', async () => {
    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversation} onSend={onSend} />);

    expect(screen.queryByRole('button', { name: /model/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Toggle voice input (Ctrl+Shift+M)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello from the phone' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(fetchedUrls()).toContain('/api/conversations/phone-conv/message'));
    const send = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === '/api/conversations/phone-conv/message');
    expect((send?.[1] as RequestInit).method).toBe('POST');
    for (const url of fetchedUrls()) {
      expect(url).not.toMatch(/\/api\/(effort\/default|settings|dashboard\/session)/);
    }
  });
});

describe('SubagentComposer in the phone app (PAN-4837)', () => {
  it('shows the computer-only line and polls nothing', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SubagentComposer
          conversation={{ ...conversation, harness: 'codex' as const }}
          subagent={{ agentId: 'child-1', agentType: 'explorer' } as never}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Sending to a subagent needs the dashboard on a computer.')).toBeInTheDocument();
    expect(fetchedUrls().filter((url) => url.includes('/subagents/'))).toEqual([]);
    client.clear();
  });
});

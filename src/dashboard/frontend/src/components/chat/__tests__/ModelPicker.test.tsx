import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '../ModelPicker';

vi.mock('sonner', () => ({
  toast: { message: vi.fn() },
}));

function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/settings/available-models') {
      return new Response(JSON.stringify({
        anthropic: [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1MTokens: 15 },
        ],
        openai: [
          { id: 'gpt-5.5', name: 'GPT-5.5', costPer1MTokens: 0 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/settings') {
      return new Response(JSON.stringify({
        models: { default_conversation_model: 'claude-sonnet-4-6' },
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

describe('chat ModelPicker live harness labels', () => {
  beforeEach(() => {
    localStorage.clear();
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels non-current harness rows experimental for live conversations', async () => {
    const user = userEvent.setup();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="claude-code"
        onHarnessChange={vi.fn()}
        liveConversation
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));

    expect(within(screen.getByRole('button', { name: /^Claude Code/i })).queryByText('Experimental')).not.toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Pi/i })).getByText('Experimental')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Codex/i })).getByText('Experimental')).toBeInTheDocument();
    expect(screen.getAllByText(/May lose fidelity/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Pi/i })).toHaveAttribute('title', expect.stringContaining('May lose fidelity'));
  });

  it('does not label harness rows experimental for the new-conversation composer', async () => {
    const user = userEvent.setup();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="claude-code"
        onHarnessChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));

    expect(screen.queryByText('Experimental')).not.toBeInTheDocument();
    expect(screen.queryByText(/May lose fidelity/)).not.toBeInTheDocument();
  });
});

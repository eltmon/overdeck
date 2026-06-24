import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '../ModelPicker';

vi.mock('sonner', () => ({
  toast: { message: vi.fn() },
}));

function installFetchMock(options: { showHarnessModelPermutations?: boolean } = {}) {
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
        google: [
          { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', costPer1MTokens: 0.4 },
        ],
        minimax: [
          { id: 'minimax-m3', name: 'MiniMax M3', costPer1MTokens: 1 },
        ],
        zai: [
          { id: 'glm-5.1', name: 'GLM 5.1', costPer1MTokens: 2 },
        ],
        kimi: [
          { id: 'kimi-k2.6-flash', name: 'Kimi K2.6 Flash', costPer1MTokens: 1 },
        ],
        mimo: [
          { id: 'mimo-vl', name: 'MiMo VL', costPer1MTokens: 1 },
        ],
        nous: [
          { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', costPer1MTokens: 0 },
        ],
        dashscope: [
          { id: 'qwen3-max', name: 'Qwen3 Max', costPer1MTokens: 2 },
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
            openai: 'codex',
            google: 'ohmypi',
            minimax: 'ohmypi',
            zai: 'ohmypi',
            kimi: 'ohmypi',
            mimo: 'ohmypi',
            openrouter: 'ohmypi',
            nous: 'ohmypi',
            dashscope: 'ohmypi',
          },
        },
        experimental: { showHarnessModelPermutations: options.showHarnessModelPermutations ?? true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/settings/openrouter/models') {
      return new Response(JSON.stringify({
        models: [{ id: 'openrouter/free-model', name: 'OpenRouter Free', promptCostPer1M: 0, supportsThinking: false }],
        favorites: ['openrouter/free-model'],
      }), {
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
    expect(within(screen.getByRole('button', { name: /^oh-my-pi/i })).getByText('Experimental')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Codex/i })).getByText('Experimental')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Code logo')).toBeInTheDocument();
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex logo')).toBeInTheDocument();
    expect(screen.getAllByText(/May lose fidelity/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^oh-my-pi/i })).toHaveAttribute('title', expect.stringContaining('May lose fidelity'));
  });

  it('renders provider logos from the shared registry for every known provider', async () => {
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

    for (const label of ['Anthropic', 'OpenAI', 'Google', 'MiniMax', 'Z.AI', 'Kimi', 'MiMo', 'Nous Portal', 'Alibaba DashScope', 'OpenRouter']) {
      expect(screen.getAllByLabelText(`${label} logo`).length).toBeGreaterThan(0);
    }
  });

  it('renders harness logos in active harness indicator chips', async () => {
    const { rerender } = render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="ohmypi"
        onHarnessChange={vi.fn()}
      />,
    );

    expect(await screen.findByTitle('oh-my-pi harness active')).toContainElement(screen.getByLabelText('oh-my-pi logo'));

    rerender(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="codex"
        onHarnessChange={vi.fn()}
      />,
    );

    expect(await screen.findByTitle('Codex harness active')).toContainElement(screen.getByLabelText('Codex logo'));
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

  it('hides harness rows by default and switches to the selected model provider default harness', async () => {
    vi.unstubAllGlobals();
    installFetchMock({ showHarnessModelPermutations: false });
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onHarnessChange = vi.fn();
    const onComboChange = vi.fn();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={onChange}
        harness="claude-code"
        onHarnessChange={onHarnessChange}
        onComboChange={onComboChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));

    expect(screen.queryByRole('button', { name: /^Pi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Codex/i })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /GPT-5\.5/i }));

    expect(onComboChange).toHaveBeenCalledWith('gpt-5.5', [], 'codex');
    expect(onChange).not.toHaveBeenCalled();
    expect(onHarnessChange).not.toHaveBeenCalled();
  });
});

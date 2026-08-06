import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPicker, loadStoredModel, onKnownModelsSync } from '../ModelPicker';
import { applyDefaultConversationModel } from '../defaultConversationModel';

vi.mock('sonner', () => ({
  toast: { message: vi.fn() },
}));

type HarnessPolicyDecisionsMap = Record<string, Record<string, { allowed: boolean; reason?: string }>>;

function installFetchMock(options: { showHarnessModelPermutations?: boolean; harnessPolicyDecisions?: HarnessPolicyDecisionsMap; defaultConversationModel?: string; availableModelsGate?: Promise<void> } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/settings/available-models') {
      await options.availableModelsGate;
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
          default_conversation_model: options.defaultConversationModel ?? 'claude-sonnet-4-6',
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
      return new Response(JSON.stringify({ decisions: options.harnessPolicyDecisions ?? {} }), {
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
    expect(within(screen.getByRole('button', { name: /^ACP/i })).getByText('Experimental')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Kimi Code/i })).getByText('Experimental')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Code logo')).toBeInTheDocument();
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex logo')).toBeInTheDocument();
    expect(screen.getByLabelText('ACP logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Kimi Code logo')).toBeInTheDocument();
    expect(screen.getAllByText(/May lose fidelity/)).toHaveLength(4);
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

  it('re-seeds a stored model after the available model list resolves', async () => {
    localStorage.setItem('conv-composer-model', 'kimi-k2.6-flash');
    const onChange = vi.fn();

    render(<ModelPicker value="" onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('kimi-k2.6-flash', []);
    });
  });

  it('does not re-seed a live conversation', async () => {
    localStorage.setItem('conv-composer-model', 'kimi-k2.6-flash');
    const onChange = vi.fn();

    render(<ModelPicker value="" onChange={onChange} liveConversation />);

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/settings/harness-policy'));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses the current live-conversation state when model discovery finishes', async () => {
    vi.unstubAllGlobals();
    let releaseAvailableModels!: () => void;
    const availableModelsGate = new Promise<void>((resolve) => {
      releaseAvailableModels = resolve;
    });
    installFetchMock({ availableModelsGate });
    localStorage.setItem('conv-composer-model', 'kimi-k2.6-flash');
    const onChange = vi.fn();

    const view = render(<ModelPicker value="" onChange={onChange} />);
    view.rerender(<ModelPicker value="" onChange={onChange} liveConversation />);
    releaseAvailableModels();

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/settings/harness-policy'));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves an empty selection when no stored or configured default exists', async () => {
    vi.unstubAllGlobals();
    installFetchMock({ defaultConversationModel: '' });
    applyDefaultConversationModel('');
    const onChange = vi.fn();

    render(<ModelPicker value="" onChange={onChange} />);

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/settings/harness-policy'));
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('chat ModelPicker blocked harness (PAN-2528)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BLOCK_REASON = 'ohmypi cannot run Anthropic models when authenticated via Claude Code subscription.';
  const blockedDecisions: HarnessPolicyDecisionsMap = {
    'claude-sonnet-4-6': {
      ohmypi: { allowed: false, reason: BLOCK_REASON },
    },
  };

  it('disables the blocked ohmypi option with the inline reason visible (PAN-2528 ac1, ac2)', async () => {
    installFetchMock({ harnessPolicyDecisions: blockedDecisions });
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

    const ohmypi = screen.getByRole('button', { name: /^oh-my-pi/i });
    // ac1: blocked option carries the disabled attribute
    expect(ohmypi).toBeDisabled();
    // ac2: the decision reason renders as visible inline text, not just title
    expect(within(ohmypi).getByText(BLOCK_REASON)).toBeInTheDocument();
    // title still mirrors the reason for hover affordance
    expect(ohmypi).toHaveAttribute('title', BLOCK_REASON);
  });

  it('clicking a blocked harness emits no toast and fires no callbacks (PAN-2528 ac3)', async () => {
    installFetchMock({ harnessPolicyDecisions: blockedDecisions });
    const user = userEvent.setup();
    const onHarnessChange = vi.fn();
    const onComboChange = vi.fn();
    const onChange = vi.fn();
    const { toast } = await import('sonner');

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

    // user-event respects disabled buttons — fireEvent bypasses the guard,
    // exercising the handleClick early-return path the harness attribute would
    // otherwise short-circuit at the DOM layer.
    const ohmypi = screen.getByRole('button', { name: /^oh-my-pi/i });
    fireEvent.click(ohmypi);

    expect(onHarnessChange).not.toHaveBeenCalled();
    expect(onComboChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
  });

  it('clicking an allowed harness still fires onHarnessChange (PAN-2528 ac4)', async () => {
    installFetchMock({ harnessPolicyDecisions: blockedDecisions });
    const user = userEvent.setup();
    const onHarnessChange = vi.fn();
    const onComboChange = vi.fn();
    const onChange = vi.fn();

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

    await user.click(screen.getByRole('button', { name: /^Codex/i }));

    expect(onHarnessChange).toHaveBeenCalledWith('codex');
    expect(onComboChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables kimi-code for a non-Kimi model with the wi4 policy reason visible (PAN-1837 wi11.ac3)', async () => {
    const KIMI_ONLY_REASON = 'The Kimi Code harness runs Kimi (Moonshot) models only. Pick a Kimi model, or use the model\'s supported harness.';
    installFetchMock({
      harnessPolicyDecisions: {
        'claude-sonnet-4-6': {
          'kimi-code': { allowed: false, reason: KIMI_ONLY_REASON },
        },
      },
    });
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

    const kimiCode = screen.getByRole('button', { name: /^Kimi Code/i });
    expect(kimiCode).toBeDisabled();
    expect(within(kimiCode).getByText(KIMI_ONLY_REASON)).toBeInTheDocument();
  });
});

describe('chat ModelPicker Kimi harness-labeled rows (2026-08-02)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Mirrors the annotated available-models payload the server emits after the
   * 2026-08-02 change: Kimi entries carry baseName + effortLevels, native ids
   * come pre-suffixed for flat panels.
   */
  function installKimiFetchMock() {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === '/api/settings/available-models') {
        return new Response(JSON.stringify({
          anthropic: [
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1MTokens: 15 },
          ],
          kimi: [
            { id: 'k3', name: 'Kimi K3 (256K)', costPer1MTokens: 1, harness: 'claude-code', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], baseName: 'Kimi K3 (256K)' },
            { id: 'k3[1m]', name: 'Kimi K3 (1M)', costPer1MTokens: 1, harness: 'claude-code', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], baseName: 'Kimi K3 (1M)' },
            { id: 'kimi-code/k3', name: 'Kimi K3 (1M) — Kimi Code CLI', costPer1MTokens: 1, harness: 'kimi-code', effortLevels: ['low', 'high', 'max'], baseName: 'Kimi K3 (1M)' },
            { id: 'kimi-code/k3-256k', name: 'Kimi K3 (256K) — Kimi Code CLI', costPer1MTokens: 1, harness: 'kimi-code', effortLevels: ['low', 'high', 'max'], baseName: 'Kimi K3 (256K)' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/api/settings') {
        return new Response(JSON.stringify({
          models: {
            default_conversation_model: 'claude-sonnet-4-6',
            provider_harnesses: {},
            provider_default_harnesses: { anthropic: 'claude-code', kimi: 'claude-code' },
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

  it('expands Kimi models into one row per launch route with no "(native)" labels', async () => {
    installKimiFetchMock();
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

    // Bare ids launch through Claude Code's Anthropic-compatible route.
    expect(await screen.findByRole('button', { name: /Kimi K3 \(256K\) — Claude Code/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kimi K3 \(1M\) — Claude Code/ })).toBeInTheDocument();
    // Native ids launch through the kimi CLI directly or over ACP.
    expect(screen.getByRole('button', { name: /Kimi K3 \(1M\) — Kimi Code CLI/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kimi K3 \(1M\) — ACP \(Kimi Code\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kimi K3 \(256K\) — Kimi Code CLI/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kimi K3 \(256K\) — ACP \(Kimi Code\)/ })).toBeInTheDocument();
    // The old meaningless marker is gone everywhere.
    expect(screen.queryByText(/\(native/)).not.toBeInTheDocument();
  });

  it('clicking the Kimi Code CLI row picks the kimi-code harness with native effort levels', async () => {
    installKimiFetchMock();
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
    await user.click(await screen.findByRole('button', { name: /Kimi K3 \(1M\) — Kimi Code CLI/ }));

    expect(onComboChange).toHaveBeenCalledWith('kimi-code/k3', ['low', 'high', 'max'], 'kimi-code');
    expect(onChange).not.toHaveBeenCalled();
    expect(onHarnessChange).not.toHaveBeenCalled();
    expect(localStorage.getItem('conv-composer-harness')).toBe('kimi-code');
    expect(localStorage.getItem('conv-composer-model')).toBe('kimi-code/k3');
  });

  it('clicking the ACP row picks the acp harness', async () => {
    installKimiFetchMock();
    const user = userEvent.setup();
    const onComboChange = vi.fn();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="claude-code"
        onHarnessChange={vi.fn()}
        onComboChange={onComboChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));
    await user.click(await screen.findByRole('button', { name: /Kimi K3 \(256K\) — ACP \(Kimi Code\)/ }));

    expect(onComboChange).toHaveBeenCalledWith('kimi-code/k3-256k', ['low', 'high', 'max'], 'acp');
  });

  it('clicking a bare Kimi row picks the claude-code harness with five effort levels', async () => {
    installKimiFetchMock();
    const user = userEvent.setup();
    const onComboChange = vi.fn();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={vi.fn()}
        harness="codex"
        onHarnessChange={vi.fn()}
        onComboChange={onComboChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));
    await user.click(await screen.findByRole('button', { name: /Kimi K3 \(256K\) — Claude Code/ }));

    expect(onComboChange).toHaveBeenCalledWith('k3', ['low', 'medium', 'high', 'xhigh', 'max'], 'claude-code');
  });

  it('falls back to onChange + onHarnessChange when onComboChange is not provided', async () => {
    installKimiFetchMock();
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onHarnessChange = vi.fn();
    render(
      <ModelPicker
        value="claude-sonnet-4-6"
        onChange={onChange}
        harness="claude-code"
        onHarnessChange={onHarnessChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude Sonnet 4\.6/i }));
    await user.click(await screen.findByRole('button', { name: /Kimi K3 \(1M\) — ACP \(Kimi Code\)/ }));

    expect(onChange).toHaveBeenCalledWith('kimi-code/k3', ['low', 'high', 'max']);
    expect(onHarnessChange).toHaveBeenCalledWith('acp');
  });

  it('trigger label shows the row matching the current harness', async () => {
    installKimiFetchMock();
    const { rerender } = render(
      <ModelPicker
        value="kimi-code/k3"
        onChange={vi.fn()}
        harness="kimi-code"
        onHarnessChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: /Kimi K3 \(1M\) — Kimi Code CLI/ })).toBeInTheDocument();

    rerender(
      <ModelPicker
        value="kimi-code/k3"
        onChange={vi.fn()}
        harness="acp"
        onHarnessChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: /Kimi K3 \(1M\) — ACP \(Kimi Code\)/ })).toBeInTheDocument();
  });

  it('notifies catalog-sync subscribers so a stored catalog-only model restores after load', async () => {
    installKimiFetchMock();
    // The composer stores the picked id in localStorage. At mount (before the
    // catalog fetch resolves) kimi-code/k3 is not a FALLBACK id, so the
    // composer's initial loadStoredModel falls back to the default — the
    // re-derive on catalog sync is what restores the user's pick.
    localStorage.setItem('conv-composer-model', 'kimi-code/k3');
    const restored: string[] = [];
    const unsubscribe = onKnownModelsSync(() => restored.push(loadStoredModel()));

    render(<ModelPicker value="claude-sonnet-4-6" onChange={vi.fn()} />);

    await waitFor(() => expect(restored.length).toBeGreaterThan(0));
    expect(restored[restored.length - 1]).toBe('kimi-code/k3');
    unsubscribe();
  });

  it('keeps the default when the stored model is absent from the synced catalog', async () => {
    installKimiFetchMock();
    localStorage.setItem('conv-composer-model', 'kimi-code/removed-from-catalog');
    const restored: string[] = [];
    const unsubscribe = onKnownModelsSync(() => restored.push(loadStoredModel('claude-fable-5')));

    render(<ModelPicker value="claude-sonnet-4-6" onChange={vi.fn()} />);

    await waitFor(() => expect(restored.length).toBeGreaterThan(0));
    expect(restored[restored.length - 1]).toBe('claude-fable-5');
    unsubscribe();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeStructuredCallError,
  type RunClaudeStructuredInput,
} from '../../../src/lib/background-ai/claude-structured.js';
import {
  extractWithProviderPolicy,
  interactiveExtractionSelection,
  isExtractionProviderAuthError,
  registerExtractionProvider,
  type ExtractionProviderSelection,
} from '../../../src/lib/memory/providers/index.js';
import { ClaudeCliExtractionProvider } from '../../../src/lib/memory/providers/claude-cli.js';

interface ExtractedPayload {
  summary: string;
}

const identity = {
  projectId: 'overdeck',
  workspaceId: 'feature-pan-4374',
  issueId: 'PAN-4374',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

function stubRun(envelope: Record<string, unknown>): (input: RunClaudeStructuredInput) => Promise<Record<string, unknown>> {
  return vi.fn(async () => envelope);
}

describe('ClaudeCliExtractionProvider', () => {
  afterEach(() => {
    registerExtractionProvider(new ClaudeCliExtractionProvider());
  });

  it('returns structured_output as data and records the envelope total_cost_usd', async () => {
    const run = stubRun({
      is_error: false,
      structured_output: { summary: 'ok' },
      total_cost_usd: 0.0009,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      session_id: 's1',
    });
    const provider = new ClaudeCliExtractionProvider(run);

    const result = await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { identity });

    expect(result.data).toEqual({ summary: 'ok' });
    expect(result.cost.usd).toBe(0.0009);
    expect(result.provider).toBe('claude-cli');
    expect(result.requestId).toBe('claude-cli-s1');
  });

  it('falls back to parsing the result string when structured_output is absent', async () => {
    const run = stubRun({
      is_error: false,
      result: JSON.stringify({ summary: 'from result text' }),
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new ClaudeCliExtractionProvider(run);

    const result = await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { identity });

    expect(result.data).toEqual({ summary: 'from result text' });
  });

  it('passes --no-session-persistence and --system-prompt as extraArgs and the 60 s timeout', async () => {
    const run = vi.fn(async () => ({ structured_output: { summary: 'ok' } }));
    const provider = new ClaudeCliExtractionProvider(run);

    await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { identity, model: 'claude-haiku-5-5' });

    expect(run).toHaveBeenCalledTimes(1);
    const input = run.mock.calls[0][0] as RunClaudeStructuredInput;
    expect(input.timeoutMs).toBe(60_000);
    expect(input.extraArgs?.[0]).toBe('--no-session-persistence');
    expect(input.extraArgs?.[1]).toBe('--system-prompt');
    expect(typeof input.extraArgs?.[2]).toBe('string');
  });

  it('throws ExtractionProviderAuthError for a Not logged in ClaudeStructuredCallError, and a plain error otherwise', async () => {
    const authError = new ClaudeStructuredCallError('Not logged in · Please run /login', {
      exitCode: 1,
      resultText: 'Not logged in · Please run /login',
      apiErrorStatus: null,
      authFailure: true,
    });
    const authProvider = new ClaudeCliExtractionProvider(vi.fn(async () => { throw authError; }));
    await expect(authProvider.extract('summarize', { type: 'object' }, { identity }))
      .rejects.toSatisfy((error: unknown) => isExtractionProviderAuthError(error));

    const plainProvider = new ClaudeCliExtractionProvider(vi.fn(async () => { throw new Error('boom'); }));
    await expect(plainProvider.extract('summarize', { type: 'object' }, { identity }))
      .rejects.toThrow('boom');
  });

  it('the policy records provider-auth-failed in health for a Not logged in result', async () => {
    const authError = new ClaudeStructuredCallError('Not logged in · Please run /login', {
      exitCode: 1,
      resultText: 'Not logged in · Please run /login',
      apiErrorStatus: null,
      authFailure: true,
    });
    registerExtractionProvider(new ClaudeCliExtractionProvider(vi.fn(async () => { throw authError; })));

    const selection: ExtractionProviderSelection = {
      provider: 'claude-cli',
      model: 'claude-haiku-5-5',
      fallbackChain: [],
      source: 'settings',
    };
    const recordHealth = vi.fn(async () => undefined);

    await extractWithProviderPolicy('summarize', { type: 'object' }, { identity }, {
      selection,
      getDailySpendUsd: () => 0,
      recordHealth,
    });

    expect(recordHealth).toHaveBeenCalledWith(identity, expect.objectContaining({ reason: 'provider-auth-failed' }));
  });

  it('declares latencyClass background and interactiveExtractionSelection drops it', () => {
    registerExtractionProvider(new ClaudeCliExtractionProvider());

    const claudeCliPrimary: ExtractionProviderSelection = {
      provider: 'claude-cli',
      model: 'claude-haiku-5-5',
      fallbackChain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      source: 'settings',
    };
    expect(interactiveExtractionSelection(claudeCliPrimary)).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      fallbackChain: [],
      source: 'settings',
    });

    const anthropicPrimary: ExtractionProviderSelection = {
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      fallbackChain: [{ provider: 'claude-cli', model: 'claude-haiku-5-5' }],
      source: 'settings',
    };
    expect(interactiveExtractionSelection(anthropicPrimary)).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      fallbackChain: [],
      source: 'settings',
    });

    const onlyClaudeCli: ExtractionProviderSelection = {
      provider: 'claude-cli',
      model: 'claude-haiku-5-5',
      fallbackChain: [],
      source: 'settings',
    };
    expect(interactiveExtractionSelection(onlyClaudeCli)).toBeNull();
  });
});

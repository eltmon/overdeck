import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '@typesafe-ai/sdk';
import type { CostEvent } from '../../costs/events.js';

const captured: CostEvent[] = [];
vi.mock('../../costs/events.js', () => ({
  appendCostEvent: (event: CostEvent) => {
    captured.push(event);
  },
}));

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV, type NormalizedJevConfig } from '../../config-yaml/jev.js';
import type { JevConfigInput } from '../config.js';
import { resetJevMemo } from '../memo.js';
import { assessTurnEnd, buildTurnEndState, formatTurnEndSummary, toTurnEndView, type TurnEndAssessment } from '../turn-end.js';

const ROLE = 'work';

function config(opts: { jevTurnEndAssessment?: boolean; jev?: Partial<NormalizedJevConfig> } = {}): JevConfigInput {
  return {
    backgroundAi: {
      cheapMode: false,
      features: { ...defaultBackgroundAiFeatures(), jevTurnEndAssessment: opts.jevTurnEndAssessment ?? true },
    },
    jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x', ...opts.jev },
    apiKeys: { typesafe: 'k' },
  };
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(respond: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn<Fetch>(async (url, init) => {
    const call = { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  });
  return { fetch, calls };
}

function answeredFetch(
  answers: { turn_end_kind: { choice: string; confidence: number }; needs_operator_answer: { noul: number } },
  model = 'test-model-x',
) {
  return fakeFetch(() =>
    jsonResponse({
      model,
      answers: {
        turn_end_kind: { type: 'choice', ...answers.turn_end_kind, probabilities: {} },
        needs_operator_answer: { type: 'noul', ...answers.needs_operator_answer },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    }),
  );
}

beforeEach(() => {
  resetJevMemo();
  captured.length = 0;
});

describe('buildTurnEndState', () => {
  it('keeps the last TURN_END_STATE_MAX_CHARS characters', () => {
    const text = 'a'.repeat(9_000) + 'b'.repeat(1_000);
    const state = buildTurnEndState(ROLE, text);
    expect(state.role).toBe(ROLE);
    expect(state.last_message).toHaveLength(6_000);
    expect(state.last_message.endsWith('b'.repeat(1_000))).toBe(true);
  });
});

describe('assessTurnEnd (PAN-4371)', () => {
  it('sends state.last_message tail-trimmed to 6000 chars ending with the input tail, and state.role', async () => {
    const text = 'x'.repeat(9_986) + 'END-OF-MESSAGE';
    const { fetch, calls } = answeredFetch({
      turn_end_kind: { choice: 'progress_update', confidence: 0.8 },
      needs_operator_answer: { noul: 0.1 },
    });
    await assessTurnEnd(
      { agentId: 'a1', role: ROLE, harness: 'claude', lastAssistantText: text, messageId: 'm1' },
      { config: config(), fetch, env: {} },
    );
    expect(calls).toHaveLength(1);
    const state = calls[0].body.state as { role: string; last_message: string };
    expect(state.last_message).toHaveLength(6_000);
    expect(state.last_message.endsWith('END-OF-MESSAGE')).toBe(true);
    expect(state.role).toBe(ROLE);
  });

  it('maps an answered response to an assessed outcome', async () => {
    const { fetch } = answeredFetch({
      turn_end_kind: { choice: 'reports_blocked', confidence: 0.84 },
      needs_operator_answer: { noul: 0.2 },
    });
    const outcome = await assessTurnEnd(
      { agentId: 'a1', role: ROLE, harness: 'claude', lastAssistantText: 'I am blocked on X.', messageId: 'm1' },
      { config: config(), fetch, env: {} },
    );
    expect(outcome).toMatchObject({
      status: 'assessed',
      assessment: { kind: 'reports_blocked', confidence: 0.84, needsAnswer: false },
    });
  });

  it('returns unassessed/empty-message for blank text without a call', async () => {
    const { fetch } = answeredFetch({
      turn_end_kind: { choice: 'other', confidence: 0.9 },
      needs_operator_answer: { noul: 0 },
    });
    const outcome = await assessTurnEnd(
      { agentId: 'a1', role: ROLE, harness: 'claude', lastAssistantText: '   \n  ', messageId: 'm1' },
      { config: config(), fetch, env: {} },
    );
    expect(outcome).toEqual({ status: 'unassessed', reason: 'empty-message' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns unassessed/disabled with the gate closed, and never calls fetch', async () => {
    const { fetch } = answeredFetch({
      turn_end_kind: { choice: 'other', confidence: 0.9 },
      needs_operator_answer: { noul: 0 },
    });
    const outcome = await assessTurnEnd(
      { agentId: 'a1', role: ROLE, harness: 'claude', lastAssistantText: 'hello?', messageId: 'm1' },
      { config: config({ jevTurnEndAssessment: false }), fetch, env: {} },
    );
    expect(outcome).toEqual({ status: 'unassessed', reason: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a failed request to unassessed with the failure reason', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'nope' }, 429));
    const outcome = await assessTurnEnd(
      { agentId: 'a1', role: ROLE, harness: 'claude', lastAssistantText: 'hello?', messageId: 'm1' },
      { config: config(), fetch, env: {} },
    );
    expect(outcome).toEqual({ status: 'unassessed', reason: 'rate-limited' });
  });
});

describe('toTurnEndView (PAN-4371)', () => {
  it('drops confidence below TURN_END_MIN_CONFIDENCE and keeps it at or above', () => {
    const below = { status: 'assessed' as const, assessment: { kind: 'other' as const, confidence: 0.69, needsAnswer: false, model: 'm' } };
    const atThreshold = { status: 'assessed' as const, assessment: { kind: 'other' as const, confidence: 0.7, needsAnswer: false, model: 'm' } };
    expect(toTurnEndView(below)).toBeUndefined();
    expect(toTurnEndView(atThreshold)).toEqual(atThreshold.assessment);
  });

  it('returns undefined for an unassessed outcome', () => {
    expect(toTurnEndView({ status: 'unassessed', reason: 'disabled' })).toBeUndefined();
  });
});

describe('formatTurnEndSummary (PAN-4371)', () => {
  it('formats a blocked 0.84 view', () => {
    const view: TurnEndAssessment = { kind: 'reports_blocked', confidence: 0.84, needsAnswer: false, model: 'm' };
    expect(formatTurnEndSummary(view)).toBe('last message reads as: blocked (0.84)');
  });
});

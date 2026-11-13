import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPendingAnswerRequest, parseCodexOptionNumber, postPendingAnswer } from '../pendingInputAnswer';

describe('buildPendingAnswerRequest', () => {
  it('routes an agent answer to answer-question', () => {
    expect(buildPendingAnswerRequest({ kind: 'agent', id: 'agent-pan-1', answers: ['Yes'], toolUseId: 'tu-1' })).toEqual({
      url: '/api/agents/agent-pan-1/answer-question',
      body: { answers: ['Yes'], toolUseId: 'tu-1' },
    });
  });

  it('routes an ohmypi conversation answer to pi-ask-answer', () => {
    expect(buildPendingAnswerRequest({ kind: 'conv', id: 'conv 7', answers: ['A'], harness: 'ohmypi', toolUseId: 'tu-2' })).toEqual({
      url: '/api/conversations/conv%207/pi-ask-answer',
      body: { toolUseId: 'tu-2', answers: ['A'] },
    });
  });

  it('routes a pi conversation answer as a message: pi has no ask modal (PAN-5212)', () => {
    expect(buildPendingAnswerRequest({ kind: 'conv', id: 'conv 7', answers: ['A'], harness: 'pi', toolUseId: 'tu-2' }).url).toBe('/api/conversations/conv%207/message');
  });

  it('routes another conversation answer to message with the prose for one answer', () => {
    expect(buildPendingAnswerRequest({
      kind: 'conv',
      id: 'conv-1',
      answers: ['Ship it'],
      questions: [{ question: 'Ready?' }],
      harness: 'claude-code',
      toolUseId: 'tu-3',
    })).toEqual({
      url: '/api/conversations/conv-1/message',
      body: { message: 'Operator answered the pending question:\n\nQ: Ready?\nA: Ship it', answersToolUseId: 'tu-3' },
    });
  });

  it('omits answersToolUseId when the question id is unknown (PAN-5111)', () => {
    const request = buildPendingAnswerRequest({
      kind: 'conv',
      id: 'conv-1',
      answers: ['Ship it'],
      questions: [{ question: 'Ready?' }],
      harness: 'claude-code',
    });
    expect(request).toEqual({
      url: '/api/conversations/conv-1/message',
      body: { message: 'Operator answered the pending question:\n\nQ: Ready?\nA: Ship it' },
    });
  });

  it('pluralizes the prose for two answers', () => {
    const request = buildPendingAnswerRequest({
      kind: 'conv',
      id: 'conv-1',
      answers: ['One', 'Two'],
      questions: [{ question: 'First?' }, { question: 'Second?' }],
    });
    expect(request).toEqual({
      url: '/api/conversations/conv-1/message',
      body: { message: 'Operator answered the pending questions:\n\nQ: First?\nA: One\n\nQ: Second?\nA: Two' },
    });
  });

  it('routes a codex approval to codex-approval with the parsed option number', () => {
    expect(buildPendingAnswerRequest({ kind: 'conv', id: 'codex-1', answers: ['2. Allow'], toolUseId: 'codex-approval:abc' })).toEqual({
      url: '/api/conversations/codex-1/codex-approval',
      body: { optionNumber: 2, toolUseId: 'codex-approval:abc' },
    });
  });

  it('returns an error for a codex approval label with no option number', () => {
    expect(buildPendingAnswerRequest({ kind: 'conv', id: 'codex-1', answers: ['Allow'], toolUseId: 'codex-approval:abc' })).toEqual({
      error: 'Could not determine which option was selected',
    });
  });
});

describe('parseCodexOptionNumber', () => {
  it('reads the leading number', () => {
    expect(parseCodexOptionNumber('  3. Deny')).toBe(3);
    expect(parseCodexOptionNumber('Deny')).toBeNull();
  });
});

describe('postPendingAnswer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts JSON and returns the response body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postPendingAnswer({ url: '/api/x', body: { a: 1 } }, 'Failed to deliver answer')).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/x');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"a":1}');
  });

  it("rejects with the server's error field on a non-2xx response", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'decision-closed' }), { status: 409 })));
    await expect(postPendingAnswer({ url: '/api/x', body: {} }, 'Failed to deliver answer')).rejects.toThrow(new Error('decision-closed'));
  });

  it('falls back to the failure label and status when the body has no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 502 })));
    await expect(postPendingAnswer({ url: '/api/x', body: {} }, 'Failed to send approval')).rejects.toThrow(new Error('Failed to send approval (502)'));
  });
});

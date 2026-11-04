import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Decision } from '../../../lib/useDecisions';
import { useAskUserQuestionUiStore } from '../../../lib/askUserQuestionUiStore';
import { MobileNeedsYou } from '../MobileNeedsYou';

let decisions: Decision[] = [];
vi.mock('../../../lib/useDecisions', () => ({ useDecisions: () => decisions }));

function auq(id: string, source: Decision['source'], toolUseId: string, labels: string[], extra: Partial<Decision> = {}): Decision {
  return {
    id,
    source,
    label: id,
    kinds: ['askUserQuestion'],
    since: '2026-11-01T00:00:00.000Z',
    blocking: true,
    pendingAskUserQuestion: {
      toolUseId,
      askedAt: '2026-11-01T00:00:00.000Z',
      questions: [{ question: `Question for ${id}?`, options: labels.map((label) => ({ label })) }],
    },
    ...extra,
  } as Decision;
}

function okFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof okFetch>): { url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) };
}

async function answer(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

describe('MobileNeedsYou', () => {
  beforeEach(() => {
    decisions = [];
    useAskUserQuestionUiStore.setState({ answeredToolUseIds: new Set() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the decision context under the question', () => {
    decisions = [auq('a1', 'agent', 'operator-decision:q1', ['Yes', 'No'], {
      pendingAskUserQuestion: {
        toolUseId: 'operator-decision:q1',
        askedAt: '2026-11-01T00:00:00.000Z',
        questions: [{ question: 'Pick a path.', context: '- tried A\n- tried B', options: [{ label: 'Yes' }, { label: 'No' }] }],
      },
    })];
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.getByText('Pick a path.')).toBeInTheDocument();
    expect(screen.getByText(/tried A/)).toBeInTheDocument();
  });

  it('renders no context paragraph when the question has none', () => {
    decisions = [auq('a1', 'agent', 't1', ['Yes', 'No'])];
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.queryByText(/tried A/)).toBeNull();
  });

  it('sends an agent answer to answer-question and removes the card', async () => {
    decisions = [auq('a1', 'agent', 't1', ['Yes', 'No'])];
    const fetchMock = okFetch();
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await answer('Yes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchMock)).toEqual({ url: '/api/agents/a1/answer-question', body: { answers: ['Yes'], toolUseId: 't1' } });
    expect(useAskUserQuestionUiStore.getState().answeredToolUseIds.has('t1')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('sends an ohmypi conversation answer to pi-ask-answer', async () => {
    decisions = [auq('conv-pi', 'conversation', 't2', ['Go'], { harness: 'ohmypi' })];
    const fetchMock = okFetch();
    render(<MobileNeedsYou subjectId={null} />);
    await answer('Go');
    expect(lastCall(fetchMock)).toEqual({ url: '/api/conversations/conv-pi/pi-ask-answer', body: { toolUseId: 't2', answers: ['Go'] } });
  });

  it('sends a codex approval option number', async () => {
    decisions = [auq('codex-conv', 'conversation', 'codex-approval:x', ['1. Deny', '2. Allow'])];
    const fetchMock = okFetch();
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.queryByRole('button', { name: 'Type an answer' })).not.toBeInTheDocument();
    await answer('2. Allow');
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/conversations/codex-conv/codex-approval',
      body: { optionNumber: 2, toolUseId: 'codex-approval:x' },
    });
  });

  it('expands the ?subject= row and collapses the first', () => {
    decisions = [auq('first', 'agent', 't-first', ['A']), auq('second', 'agent', 't-second', ['B'])];
    const { container } = render(<MobileNeedsYou subjectId="second" />);
    expect(container.querySelector('[data-subject-id="first"]')).toHaveAttribute('data-expanded', 'false');
    expect(container.querySelector('[data-subject-id="second"]')).toHaveAttribute('data-expanded', 'true');
    expect(screen.queryByText('This question was already answered.')).not.toBeInTheDocument();
  });

  it('says an unknown subject was already answered', () => {
    decisions = [auq('first', 'agent', 't-first', ['A'])];
    render(<MobileNeedsYou subjectId="gone" />);
    expect(screen.getByText('This question was already answered.')).toBeInTheDocument();
  });

  it('shows Open and no options for a permission row', () => {
    decisions = [{
      id: 'conv-perm',
      source: 'conversation',
      label: 'conv-perm',
      kinds: ['permissionRequest'],
      since: '2026-11-01T00:00:00.000Z',
      blocking: true,
    }];
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('PAN-4941: shows "Answer on the desktop" and no Open for a secret request, even from a conversation', () => {
    decisions = [{
      id: '0123456789abcdef0123456789abcdef',
      source: 'conversation',
      label: 'abc',
      kinds: ['secretRequest'],
      since: '2026-11-04T00:00:00.000Z',
      blocking: true,
      agentRequest: {
        id: '0123456789abcdef0123456789abcdef',
        kind: 'secret',
        name: 'OPENAI_API_KEY',
        prompt: 'The key',
        agentId: 'abc',
        expiresAt: '2026-11-04T00:10:00.000Z',
      },
    }];
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.getByText('Answer on the desktop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('PAN-4946: shows "Approve on the desktop" and no Open for an MCP sign-in', () => {
    decisions = [{
      id: 'appr-1',
      source: 'agent',
      label: 'Claude Desktop',
      kinds: ['mcpSignIn'],
      since: '2026-11-04T00:00:00.000Z',
      blocking: true,
      mcpSignIn: {
        id: 'appr-1',
        clientId: 'odc_123',
        clientName: 'Claude Desktop',
        redirectHost: 'localhost',
        requestedLevel: 'operate',
        approvalCode: 'ABCDE',
        createdAt: '2026-11-04T00:00:00.000Z',
        expiresAt: '2026-11-04T00:10:00.000Z',
      },
    }];
    render(<MobileNeedsYou subjectId={null} />);
    expect(screen.getByText('Approve on the desktop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('shows the server error under the card and un-marks the question', async () => {
    decisions = [auq('a1', 'agent', 't1', ['Yes'])];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    render(<MobileNeedsYou subjectId={null} />);
    await answer('Yes');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
    expect(useAskUserQuestionUiStore.getState().answeredToolUseIds.has('t1')).toBe(false);
  });

  it('sends typed text instead of the selection', async () => {
    decisions = [auq('c1', 'conversation', 't3', ['Yes'], { harness: 'claude-code' })];
    const fetchMock = okFetch();
    render(<MobileNeedsYou subjectId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Type an answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Use the other branch' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/conversations/c1/message',
      body: { message: 'Operator answered the pending question:\n\nQ: Question for c1?\nA: Use the other branch' },
    });
  });
});

/** PAN-5091: `pan conversations resume <name>` calls the resume route, prints the result, and exits non-zero on a refusal. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, { get: () => new Proxy(identity, { get: () => identity }) });
  return { default: chalk };
});

const { DashboardUnreachableError } = await import('../../dashboard-call.js');
const { resumeConversation } = await import('../resume.js');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(response: Response | (() => Promise<Response>)) {
  const out: string[] = [];
  const err: string[] = [];
  const call = vi.fn(async () => (typeof response === 'function' ? response() : response));
  return { call, out, err, deps: { call: call as never, log: (line: string) => out.push(line), error: (line: string) => err.push(line) } };
}

describe('pan conversations resume (PAN-5091)', () => {
  it('posts {} to the encoded resume route and prints Resumed', async () => {
    const h = harness(json({ name: '20261106-0913', status: 'active', reattached: false }));
    expect(await resumeConversation('20261106-0913', {}, h.deps)).toBe(0);
    expect(h.call).toHaveBeenCalledWith('/api/conversations/20261106-0913/resume', { method: 'POST', body: {} });
    expect(h.out).toEqual(['Resumed 20261106-0913.']);
    expect(h.err).toEqual([]);
  });

  it('encodes @<machine>/<name> as one segment for the linked-conversation proxy', async () => {
    const h = harness(json({ name: 'conv-a', reattached: false }));
    expect(await resumeConversation('@desk/conv-a', {}, h.deps)).toBe(0);
    expect(h.call).toHaveBeenCalledWith('/api/conversations/%40desk%2Fconv-a/resume', { method: 'POST', body: {} });
  });

  it('says a conversation that still runs was reattached, and exits 0', async () => {
    const h = harness(json({ name: 'conv-a', reattached: true }));
    expect(await resumeConversation('conv-a', {}, h.deps)).toBe(0);
    expect(h.out).toEqual(['conv-a is already running; nothing to resume.']);
  });

  it('names the chain head a /clear row resumed through', async () => {
    const h = harness(json({ name: 'conv-b', reattached: false, redirectedFrom: 'conv-a' }));
    expect(await resumeConversation('conv-a', {}, h.deps)).toBe(0);
    expect(h.out).toEqual(['Resumed conv-b (continuing conv-a).']);
  });

  it('--json prints the route body', async () => {
    const body = { name: 'conv-a', status: 'active', reattached: false };
    const h = harness(json(body));
    expect(await resumeConversation('conv-a', { json: true }, h.deps)).toBe(0);
    expect(JSON.parse(h.out[0]!)).toEqual(body);
  });

  it('exits 1 and prints the error on a refusal', async () => {
    const h = harness(json({ error: 'Continued on desk; this copy is read-only', code: 'conversation-released' }, 409));
    expect(await resumeConversation('conv-a', {}, h.deps)).toBe(1);
    expect(h.err).toEqual(['Error: Continued on desk; this copy is read-only']);
    expect(h.out).toEqual([]);
  });

  it('exits 2 when the conversation does not exist', async () => {
    const h = harness(json({ error: 'Conversation not found' }, 404));
    expect(await resumeConversation('nope', {}, h.deps)).toBe(2);
    expect(h.err).toEqual(['Error: Conversation not found']);
  });

  it('exits 1 with a hint when the dashboard is not running', async () => {
    const h = harness(async () => { throw new DashboardUnreachableError('ECONNREFUSED'); });
    expect(await resumeConversation('conv-a', {}, h.deps)).toBe(1);
    expect(h.err[0]).toContain('the dashboard is not running');
  });
});

/** PAN-4650 WI-16: `pan tell @<machine>/<conv>` posts through the dashboard with a message id and the sender. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, { get: () => new Proxy(identity, { get: () => identity }) });
  return { default: chalk };
});

const callDashboard = vi.fn();
vi.mock('../dashboard-call.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-call.js')>()),
  callDashboard: (path: string, init: unknown) => callDashboard(path, init),
}));

const { tellRemote } = await import('../tell.js');

const originalAgentId = process.env.OVERDECK_AGENT_ID;
let errors: string[];
let logs: string[];

beforeEach(() => {
  delete process.env.OVERDECK_AGENT_ID;
  callDashboard.mockReset();
  errors = [];
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => { errors.push(String(line)); });
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)); });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAgentId === undefined) delete process.env.OVERDECK_AGENT_ID;
  else process.env.OVERDECK_AGENT_ID = originalAgentId;
});

describe('pan tell to a linked machine (PAN-4650 WI-16)', () => {
  it('posts the message with clientMessageId and the operator sender, and reports delivery', async () => {
    callDashboard.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await tellRemote('@desk/conv-x', 'hi', { messageId: 'm1' })).toBe(0);
    expect(callDashboard).toHaveBeenCalledWith('/api/conversations/@desk/conv-x/message', {
      method: 'POST',
      body: { message: 'hi', clientMessageId: 'm1' },
      headers: { 'x-overdeck-sender': `conv-operator-${process.pid}` },
    });
    expect(logs).toEqual(['Delivered to conv-x on desk']);
  });

  it('sends an agent sender as itself, a steer as deliverAs steer, and a fresh id by default', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-4650';
    callDashboard.mockResolvedValue(new Response('{}', { status: 200 }));
    await tellRemote('@desk/conv-x', 'now', { steer: true });
    const init = callDashboard.mock.calls[0]![1] as { body: { clientMessageId: string; deliverAs?: string }; headers: Record<string, string> };
    expect(init.headers['x-overdeck-sender']).toBe('agent-pan-4650');
    expect(init.body.deliverAs).toBe('steer');
    expect(init.body.clientMessageId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses agents, --when-limit-resets and --force without sending', async () => {
    expect(await tellRemote('@desk/agent-pan-1', 'hi', {})).toBe(1);
    expect(errors).toContain('pan tell @<label>/… targets conversations only');
    expect(await tellRemote('@desk/conv-x', 'hi', { whenLimitResets: true })).toBe(1);
    expect(await tellRemote('@desk/conv-x', 'hi', { force: true })).toBe(1);
    expect(callDashboard).not.toHaveBeenCalled();
  });

  it("prints the owner's error and exits 1 when delivery fails", async () => {
    callDashboard.mockResolvedValue(new Response(JSON.stringify({ error: 'desk is offline', code: 'machine-offline' }), { status: 503 }));
    expect(await tellRemote('@desk/conv-x', 'hi', {})).toBe(1);
    expect(errors).toEqual(['Message NOT delivered to conv-x on desk: desk is offline']);
  });
});

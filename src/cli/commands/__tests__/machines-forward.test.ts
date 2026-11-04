/** PAN-4650 WI-18: `pan machines forward <machine> <port>` prints the local URL; --list and --stop. */
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

const { runMachinesForward } = await import('../machines.js');

const FORWARD = { id: 'fwd-1', label: 'desk', port: 5173, localPort: 49152, url: 'http://127.0.0.1:49152', connections: 0 };
let logs: string[];

beforeEach(() => {
  callDashboard.mockReset();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)); });
});

afterEach(() => vi.restoreAllMocks());

describe('pan machines forward (PAN-4650 WI-18)', () => {
  it('posts the port and prints the 127.0.0.1 URL', async () => {
    callDashboard.mockResolvedValue(new Response(JSON.stringify(FORWARD), { status: 200 }));
    await runMachinesForward('desk', '5173', {});
    expect(callDashboard).toHaveBeenCalledWith('/api/machines/desk/forwards', { method: 'POST', body: { port: 5173 } });
    expect(logs[0]).toBe('Forwarding desk:5173 → http://127.0.0.1:49152');
  });

  it('lists and stops forwards', async () => {
    callDashboard.mockResolvedValueOnce(new Response(JSON.stringify({ forwards: [FORWARD] }), { status: 200 }));
    await runMachinesForward(undefined, undefined, { list: true });
    expect(logs[0]).toBe('fwd-1  desk:5173 → http://127.0.0.1:49152  (0 open)');
    callDashboard.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await runMachinesForward(undefined, undefined, { stop: 'fwd-1' });
    expect(callDashboard).toHaveBeenLastCalledWith('/api/machines/forwards/fwd-1', { method: 'DELETE' });
  });
});

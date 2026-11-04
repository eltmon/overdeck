/**
 * PAN-4945: `pan mcp oauth` verbs against a mocked `callDashboard` — the
 * request each verb sends, the D-13 output, and the exit codes.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const { DashboardUnreachableError } = await import('../../../src/cli/commands/dashboard-call.js');
const {
  runMcpOAuthDecide,
  runMcpOAuthIssue,
  runMcpOAuthList,
  runMcpOAuthPending,
  runMcpOAuthRevoke,
} = await import('../../../src/cli/commands/mcp-oauth.js');

type Call = { path: string; init: { method: string; body?: unknown } };

let calls: Call[];
let stdout: string[];
let stderr: string[];
let answer: (call: Call) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const deps = {
  callDashboard: async (path: string, init: { method: string; body?: unknown }) => {
    const call = { path, init };
    calls.push(call);
    return answer(call);
  },
  stdout: (line: string) => { stdout.push(line); },
  stderr: (line: string) => { stderr.push(line); },
};

const APPROVAL = { id: 'a'.repeat(32), clientName: 'Claude', redirectHost: '127.0.0.1:53682', requestedLevel: 'read', approvalCode: 'KQZT-MWRB', expiresAt: '2026-11-04T12:10:00.000Z' };

beforeEach(() => {
  calls = [];
  stdout = [];
  stderr = [];
  answer = () => json({});
});

describe('pan mcp oauth (PAN-4945)', () => {
  it('issue posts the name and level and prints both tokens once', async () => {
    answer = () => json({ clientId: `odc_${'1'.repeat(32)}`, familyId: '2'.repeat(32), level: 'message', access_token: 'odk_access', refresh_token: 'odr_refresh', expires_in: 2_592_000 }, 201);
    await expect(runMcpOAuthIssue(deps, { name: 'n', level: 'message' })).resolves.toBe(0);
    expect(calls).toEqual([{ path: '/api/mcp-oauth/issue', init: { method: 'POST', body: { name: 'n', level: 'message' } } }]);
    const out = stdout.join('\n');
    expect(out).toContain('odk_access');
    expect(out).toContain('odr_refresh');
    expect(stdout.at(-1)).toBe('These tokens are shown once. Store them in your client now.');
  });

  it('issue --level admin exits 1 without calling the dashboard', async () => {
    await expect(runMcpOAuthIssue(deps, { name: 'n', level: 'admin' })).resolves.toBe(1);
    expect(calls).toEqual([]);
    expect(stderr.join('\n')).toContain('read, message, operate, approve');
  });

  it('approve finds the approval by code, case- and dash-insensitively, and posts the decision', async () => {
    answer = (call) => (call.init.method === 'GET' ? json({ approvals: [APPROVAL] }) : json({ status: 'approved' }));
    await expect(runMcpOAuthDecide(deps, 'kqzt-mwrb', 'approve', 'operate')).resolves.toBe(0);
    expect(calls[1]).toEqual({ path: `/api/mcp-oauth/approvals/${APPROVAL.id}`, init: { method: 'POST', body: { decision: 'approve', level: 'operate' } } });
    await expect(runMcpOAuthDecide(deps, 'kqztmwrb', 'deny')).resolves.toBe(0);
    expect(calls[3]).toEqual({ path: `/api/mcp-oauth/approvals/${APPROVAL.id}`, init: { method: 'POST', body: { decision: 'deny' } } });
  });

  it('approve with an unknown code exits 1', async () => {
    answer = () => json({ approvals: [APPROVAL] });
    await expect(runMcpOAuthDecide(deps, 'NOPE-NOPE', 'approve', 'read')).resolves.toBe(1);
    expect(stderr).toEqual(['No waiting sign-in has code NOPE-NOPE.']);
    expect(calls).toHaveLength(1);
  });

  it('revoke maps 404 to a plain message and exit 1', async () => {
    answer = () => json({ error: 'no active sign-in' }, 404);
    await expect(runMcpOAuthRevoke(deps, 'f'.repeat(32))).resolves.toBe(1);
    expect(stderr).toEqual([`No active sign-in ${'f'.repeat(32)}.`]);
    answer = () => json({ revoked: true });
    await expect(runMcpOAuthRevoke(deps, 'f'.repeat(32))).resolves.toBe(0);
    expect(stdout).toEqual([`Revoked sign-in ${'f'.repeat(32)}.`]);
  });

  it('prints the not-running message when the dashboard is unreachable', async () => {
    answer = () => { throw new DashboardUnreachableError('ECONNREFUSED'); };
    await expect(runMcpOAuthRevoke(deps, 'x')).resolves.toBe(1);
    expect(stderr).toEqual(['The dashboard is not running. Start it with pan up.']);
  });

  it('prints the server error text for any other failure', async () => {
    answer = () => json({ error: 'only the internal token or the root session can manage MCP sign-ins' }, 403);
    await expect(runMcpOAuthList(deps)).resolves.toBe(1);
    expect(stderr).toEqual(['only the internal token or the root session can manage MCP sign-ins']);
  });

  it('list and pending print one line per row, or an empty message', async () => {
    answer = () => json({ signIns: [] });
    await runMcpOAuthList(deps);
    answer = () => json({ approvals: [] });
    await runMcpOAuthPending(deps);
    expect(stdout).toEqual(['No MCP sign-ins.', 'No sign-ins are waiting.']);

    stdout = [];
    answer = () => json({ signIns: [{ familyId: '2'.repeat(32), clientName: 'xAI', level: 'message', lastUsedAt: null, refreshExpiresAt: '2027-02-02T00:00:00.000Z' }] });
    await runMcpOAuthList(deps);
    answer = () => json({ approvals: [APPROVAL] });
    await runMcpOAuthPending(deps);
    expect(stdout[0]).toBe(`${'2'.repeat(32)}  message  xAI  last used never  refresh expires 2027-02-02`);
    expect(stdout[1]).toMatch(/^KQZT-MWRB {2}Claude {2}→ 127\.0\.0\.1:53682 {2}wants read {2}expires /);
  });
});


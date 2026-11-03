import type { ShareView } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import { shareCommand, type ShareDeps } from '../../../../src/cli/commands/sharing/share.js';
import { DashboardUnreachableError } from '../../../../src/cli/commands/dashboard-call.js';
import { captureIo, runCli } from '../vault/helpers.js';

const VIEW: ShareView = {
  shortCode: 'BCDFGHJK',
  joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
  scope: { kind: 'conversation', conversationId: 'conv-name' },
  createdAt: '2026-11-03T00:00:00.000Z',
  connection: 'connected',
  snapshot: null,
  lastError: null,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function deps(response: Response | Error, resolved: { name: string } | null = { name: 'conv-name' }) {
  const callDashboard = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const resolveConversation = vi.fn(() => resolved);
  return { callDashboard, resolveConversation, deps: { callDashboard, resolveConversation } as ShareDeps };
}

function allLines(io: { stdout: string[]; stderr: string[] }): string[] {
  return [...io.stdout, ...io.stderr];
}

describe('shareCommand', () => {
  it('prints the link, the join code and both join commands for a new share', async () => {
    const io = captureIo();
    const { deps: d } = deps(jsonResponse(VIEW, 201));

    const code = await runCli(() => shareCommand('conv-name', {}, io, d));

    expect(code).toBe(0);
    expect(io.exitCode).toBeNull();
    expect(io.stdout).toEqual([
      'Shared conversation conv-name.',
      'Link:      https://share.overdeck.ai/s/BCDFGHJK',
      'Join code: BCDF-GHJK',
      'Viewers join with: pan join BCDF-GHJK',
      'No Overdeck installed? npx @overdeck/core join BCDF-GHJK',
      'Let people in from the share dialog in the dashboard (⋮ → Share this conversation).',
    ]);
  });

  it('says the conversation is already shared on 200', async () => {
    const io = captureIo();
    const { deps: d } = deps(jsonResponse(VIEW, 200));

    await runCli(() => shareCommand('conv-name', {}, io, d));

    expect(io.stdout[0]).toContain('is already shared');
  });

  it('prints exactly one JSON line with --json', async () => {
    const io = captureIo();
    const { deps: d } = deps(jsonResponse(VIEW, 201));

    await runCli(() => shareCommand('conv-name', { json: true }, io, d));

    expect(io.stdout).toHaveLength(1);
    expect(JSON.parse(io.stdout[0]!)).toEqual(VIEW);
  });

  it('exits 1 without calling the dashboard when the conversation does not resolve', async () => {
    const io = captureIo();
    const { deps: d, callDashboard } = deps(jsonResponse(VIEW, 201), null);

    const code = await runCli(() => shareCommand('missing', {}, io, d));

    expect(code).toBe(1);
    expect(io.stderr[0]).toContain('No conversation matches missing');
    expect(callDashboard).not.toHaveBeenCalled();
  });

  it('exits 1 naming pan up when the dashboard is unreachable', async () => {
    const io = captureIo();
    const { deps: d } = deps(new DashboardUnreachableError('fetch failed'));

    const code = await runCli(() => shareCommand('conv-name', {}, io, d));

    expect(code).toBe(1);
    expect(io.stderr[0]).toContain('pan up');
  });

  it('prints the dashboard message on a non-2xx answer', async () => {
    const io = captureIo();
    const { deps: d } = deps(
      jsonResponse({ error: 'not_signed_in', message: 'Sign in with pan account login to share conversations.' }, 412),
    );

    const code = await runCli(() => shareCommand('conv-name', {}, io, d));

    expect(code).toBe(1);
    expect(io.stderr[0]).toContain('Sign in with pan account login to share conversations.');
  });

  it('posts the resolved conversation name for a numeric ref', async () => {
    const io = captureIo();
    const { deps: d, callDashboard, resolveConversation } = deps(jsonResponse(VIEW, 201));

    await runCli(() => shareCommand('42', {}, io, d));

    expect(resolveConversation).toHaveBeenCalledWith('42');
    expect(callDashboard).toHaveBeenCalledWith('/api/shares', { method: 'POST', body: { conversationName: 'conv-name' } });
  });

  it('prints no token in any output', async () => {
    const io = captureIo();
    const { deps: d } = deps(jsonResponse(VIEW, 201));

    await runCli(() => shareCommand('conv-name', {}, io, d));

    for (const line of allLines(io)) {
      expect(line).not.toContain('odh_');
      expect(line).not.toContain('odd_');
    }
  });
});

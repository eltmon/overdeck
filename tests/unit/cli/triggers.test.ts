/**
 * PAN-4648 W-8: `pan triggers add|list|remove|set-secret`. The trigger store
 * is real (temporary OVERDECK_HOME); conversation and project lookups are
 * faked so no database is needed.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  byName: vi.fn((name: string) => (name === '20261101-0001' ? { name } : null)),
  byId: vi.fn((id: number) => (id === 7 ? { name: '20261101-0007' } : null)),
  project: vi.fn((key: string) => (key === 'overdeck' ? { name: 'overdeck' } : null)),
}));

vi.mock('../../../src/lib/overdeck/conversations.js', () => ({
  getConversationByName: mocks.byName,
  getConversationById: mocks.byId,
}));
vi.mock('../../../src/lib/projects.js', () => ({ getProjectSync: mocks.project }));
const dashboard = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/cli/commands/dashboard-call.js', () => ({
  callDashboard: dashboard.call,
  errorText: async (response: Response) => ((await response.json()) as { error: string }).error,
  isDashboardUnreachable: () => false,
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { runTriggersAdd, runTriggersList, runTriggersRemove, runTriggersSetSecret } = await import('../../../src/cli/commands/triggers.js');
const { listPublicTriggers } = await import('../../../src/lib/triggers/store.js');

const HOOK_PATH = /\/hooks\/trg_[0-9a-f]{12}\/[0-9a-f]{64}/;
const originalHome = process.env.OVERDECK_HOME;
let home: string;
let stdout: string[];
let stderr: string[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4648-triggers-cli-'));
  process.env.OVERDECK_HOME = home;
  stdout = [];
  stderr = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { stderr.push(args.join(' ')); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('pan triggers (PAN-4648)', () => {
  it('refuses add with both targets or neither', async () => {
    await expect(runTriggersAdd('x', { conversation: '20261101-0001', project: 'overdeck', prompt: 'p' })).rejects.toThrow('exit 1');
    await expect(runTriggersAdd('x', {})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('--conversation');
    expect(stderr.join('\n')).toContain('--project');
    expect(await listPublicTriggers()).toEqual([]);
  });

  it('adds a github project trigger and prints the URL, Funnel command and a generated secret once', async () => {
    await runTriggersAdd('gh', { project: 'overdeck', prompt: 'Handle this event.', verify: 'github', harness: 'codex' });
    const out = stdout.join('\n');
    expect(out).toMatch(HOOK_PATH);
    expect(out).toMatch(/signing secret \(paste into the GitHub webhook form\): [0-9a-f]{64}/);
    expect(out).toContain('https://<machine>.<tailnet>.ts.net:8443/hooks/trg_');
    expect(out).toMatch(/tailscale funnel --bg --https=8443 --set-path=\/hooks http:\/\/127\.0\.0\.1:\d+\/hooks/);
    expect(out).toContain('The URL is shown once. Save it now.');
    const [trigger] = await listPublicTriggers();
    expect(trigger.target).toEqual({ kind: 'project', projectKey: 'overdeck', harness: 'codex' });
  });

  it('stores a conversation given by numeric id under its name, and --json prints the documented shape', async () => {
    await runTriggersAdd('ci', { conversation: '7', json: true });
    const printed = JSON.parse(stdout[0]) as Record<string, unknown>;
    expect(Object.keys(printed).sort()).toEqual(['funnelCommand', 'generatedSigningSecret', 'hookPath', 'localUrl', 'trigger', 'url']);
    expect(printed.hookPath).toMatch(HOOK_PATH);
    expect(printed.url).toBeNull();
    expect((printed.trigger as { target: unknown }).target).toEqual({ kind: 'conversation', conversation: '20261101-0007' });
  });

  it('refuses an unknown conversation and an unknown project', async () => {
    await expect(runTriggersAdd('ci', { conversation: 'nope' })).rejects.toThrow('exit 1');
    await expect(runTriggersAdd('p', { project: 'ghost', prompt: 'p' })).rejects.toThrow('exit 1');
    expect(await listPublicTriggers()).toEqual([]);
  });

  it('lists triggers without printing any 64-hex secret', async () => {
    await runTriggersAdd('gh', { conversation: '20261101-0001', verify: 'github' });
    await runTriggersAdd('st', { conversation: '20261101-0001', verify: 'stripe' });
    stdout = [];
    await runTriggersList({});
    const out = stdout.join('\n');
    expect(out).toContain('conversation 20261101-0001');
    expect(out).toContain('secret set');
    expect(out).toContain('secret not set');
    expect(out).not.toMatch(/[0-9a-f]{64}/);
  });

  it('exits 1 when removing an unknown id, and removes a known one', async () => {
    await expect(runTriggersRemove('trg_000000000000')).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('No trigger with id trg_000000000000.');

    await runTriggersAdd('ci', { conversation: '20261101-0001', json: true });
    const { trigger } = JSON.parse(stdout[0]) as { trigger: { id: string } };
    await runTriggersRemove(trigger.id);
    expect(await listPublicTriggers()).toEqual([]);
  });

  it('sets the signing secret from one stdin line, and refuses an empty one', async () => {
    await runTriggersAdd('st', { conversation: '20261101-0001', verify: 'stripe', json: true });
    const { trigger } = JSON.parse(stdout[0]) as { trigger: { id: string } };

    await expect(runTriggersSetSecret(trigger.id, {}, async () => '')).rejects.toThrow('exit 1');
    await runTriggersSetSecret(trigger.id, {}, async () => 'whsec_from_stdin\n');
    expect((await listPublicTriggers())[0].signingSecretSet).toBe(true);
    expect(stdout.join('\n')).not.toContain('whsec_from_stdin');
  });
});

describe('pan triggers add --inbox (PAN-2356 WI-20)', () => {
  const INBOX_URL = `https://connect.overdeck.ai/h/${'a'.repeat(64)}.${'b'.repeat(32)}`;

  it('creates through the dashboard and prints the inbox URL, not the Funnel lines', async () => {
    dashboard.call.mockResolvedValueOnce(new Response(JSON.stringify({
      trigger: { id: 'trg_0123456789ab', name: 'held', verify: 'none', signingSecretSet: false },
      hookPath: `/hooks/trg_0123456789ab/${'c'.repeat(64)}`,
      inboxUrl: INBOX_URL,
      generatedSigningSecret: null,
    }), { status: 201 }));
    await runTriggersAdd('held', { conversation: '20261101-0001', inbox: true });
    expect(dashboard.call).toHaveBeenCalledWith('/api/triggers', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ name: 'held', inbox: true, target: { kind: 'conversation', conversation: '20261101-0001' } }),
    }));
    const out = stdout.join('\n');
    expect(out).toContain(INBOX_URL);
    expect(out).toContain('https://connect.overdeck.ai/h/');
    expect(out).not.toContain('tailscale funnel');
    expect(out).not.toContain('Funnel URL');
  });

  it('fails with the dashboard reason when the plan has no inbox', async () => {
    dashboard.call.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'the inbox needs the Anywhere plan' }), { status: 409 }));
    await expect(runTriggersAdd('held', { conversation: '20261101-0001', inbox: true })).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('the inbox needs the Anywhere plan');
  });
});

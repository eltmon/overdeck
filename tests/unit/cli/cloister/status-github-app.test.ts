import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/cli/commands/cloister/api.js', () => ({
  cloisterApi: vi.fn(async (path: string) => {
    if (path === '/api/cloister/status') {
      return {
        running: true,
        patrol: null,
        lastCheck: null,
        summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 },
        agentsNeedingAttention: [],
        config: {
          startup: { auto_start: true },
          thresholds: { stale: 5, warning: 10, stuck: 20 },
          auto_actions: { poke_on_warning: false, kill_on_stuck: false },
        },
      };
    }
    if (path.startsWith('/api/deacon/logs')) return { logs: [] };
    return null;
  }),
}));

vi.mock('../../../../src/lib/github-app.js', () => ({
  getAppStatus: () => ({ configured: true, appId: '12345', installationId: '67890', mode: 'app' }),
  getBotIdentity: () => ({ name: 'overdeck-agent[bot]', email: '12345+overdeck-agent[bot]@users.noreply.github.com' }),
}));

import { statusCommand } from '../../../../src/cli/commands/cloister/status.js';

// PAN-5153 W8 step 6: the GitHub App section names the configured bot and
// says it pushes only where the App is installed.
describe('pan cloister status GitHub App section (PAN-5153)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the bot name from the App slug', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });

    await statusCommand({});

    const plain = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''));
    expect(plain).toContain('  ✓ overdeck-agent (App ID: 12345)');
    expect(plain).toContain('  Mode: App — agents push as overdeck-agent[bot] where the App is installed');
    expect(plain.join('\n')).not.toContain('panopticon-agent');
  });
});

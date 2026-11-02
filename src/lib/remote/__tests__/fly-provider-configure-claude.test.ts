import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlyProvider } from '../fly-provider.js';
import type { ExecResult } from '../interface.js';

describe('FlyProvider.configureClaudeCode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-answers the auto-default nudge in ~/.claude.json', async () => {
    const ssh = vi
      .spyOn(FlyProvider.prototype as unknown as { sshImpl: (vm: string, cmd: string) => Promise<ExecResult> }, 'sshImpl')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await new FlyProvider({ apiToken: 'test' }).configureClaudeCode('vm-1');

    const onboardingCommand = ssh.mock.calls
      .map(([, command]) => command as string)
      .find((command) => command.endsWith('| base64 -d | python3'));
    expect(onboardingCommand).toBeDefined();

    const b64 = /echo '([^']+)'/.exec(onboardingCommand!)?.[1];
    expect(b64).toBeDefined();
    const decoded = Buffer.from(b64!, 'base64').toString('utf8');

    expect(decoded).toContain('data["hasCompletedOnboarding"] = True');
    expect(decoded).toContain('data["hasSeenAutoDefaultNudge"] = True');

    const loadIndex = decoded.indexOf('json.load(f)');
    const nudgeIndex = decoded.indexOf('data["hasSeenAutoDefaultNudge"] = True');
    expect(loadIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBeGreaterThan(loadIndex);
  });
});

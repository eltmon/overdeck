import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  reviewIssueIdForAgent,
  withReviewLifecycleGuard,
  withReviewLifecycleGuardForAgent,
} from '../review-lifecycle-guard.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('review lifecycle guard', () => {
  it.each([
    ['agent-min-889-review', 'MIN-889'],
    ['agent-min-889-review-security', 'MIN-889'],
    ['agent-pan-3794', null],
    ['conv-min-889-review', null],
  ])('maps %s to its review family', (agentId, expected) => {
    expect(reviewIssueIdForAgent(agentId)).toBe(expected);
  });

  it('allows guarded dispatch to resume its own review family re-entrantly', async () => {
    const order: string[] = [];

    await withReviewLifecycleGuard('MIN-889', async () => {
      order.push('dispatch:start');
      await withReviewLifecycleGuardForAgent('agent-min-889-review', async () => {
        order.push('resume');
      });
      order.push('dispatch:end');
    });

    expect(order).toEqual(['dispatch:start', 'resume', 'dispatch:end']);
  });

  it('serializes a provisioned recovery resume against force replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-3794-review-lifecycle-'));
    tempDirs.push(root);
    const codexHome = join(root, 'agent-min-889-review', 'codex-home');
    const liveProcesses = new Set<string>();
    const order: string[] = [];
    let releaseRecovery!: () => void;
    let recoveryProvisioned!: () => void;
    const provisioned = new Promise<void>((resolve) => {
      recoveryProvisioned = resolve;
    });
    const recoveryPause = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });

    const recovery = withReviewLifecycleGuardForAgent('agent-min-889-review', async () => {
      await mkdir(codexHome, { recursive: true });
      await Promise.all([
        writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5.6"\n'),
        writeFile(join(codexHome, 'auth.json'), '{"token":"host-link"}\n'),
      ]);
      order.push('recovery:provisioned');
      recoveryProvisioned();
      await recoveryPause;
      liveProcesses.add('recovered-parent');
      order.push('recovery:started');
    });
    await provisioned;

    const replacement = withReviewLifecycleGuard('MIN-889', async () => {
      order.push('replacement:entered');
      liveProcesses.clear();
      await rm(join(root, 'agent-min-889-review'), { recursive: true, force: true });
      await mkdir(codexHome, { recursive: true });
      await Promise.all([
        writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5.6"\n'),
        writeFile(join(codexHome, 'auth.json'), '{"token":"host-link"}\n'),
      ]);
      liveProcesses.add('replacement-parent');
      order.push('replacement:started');
    });

    await Promise.resolve();
    expect(order).toEqual(['recovery:provisioned']);

    releaseRecovery();
    await Promise.all([recovery, replacement]);

    expect(order).toEqual([
      'recovery:provisioned',
      'recovery:started',
      'replacement:entered',
      'replacement:started',
    ]);
    expect([...liveProcesses]).toEqual(['replacement-parent']);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(true);
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(true);
  });

  it('releases the issue queue when an operation fails', async () => {
    await expect(withReviewLifecycleGuard('PAN-3794', async () => {
      throw new Error('replacement failed');
    })).rejects.toThrow('replacement failed');

    await expect(withReviewLifecycleGuard('pan-3794', async () => 'recovered')).resolves.toBe('recovered');
  });
});

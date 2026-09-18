import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/post-merge-deploy.sh');
const script = readFileSync(scriptPath, 'utf8');

describe('post-merge deploy restart handoff', () => {
  it.each([
    ['independent process supervision', 'OVERDECK_POST_MERGE_DEPLOY_SUPERVISED'],
    ['unbounded failure retries', '--property=Restart=on-failure'],
    ['operator escalation after repeated failures', 'maybe_escalate_repeated_failures'],
    ['single-deploy locking', 'flock -x -n 9'],
    ['planned-restart lifecycle marker', 'dashboard-restarting.json'],
    ['post-merge lifecycle continuity', 'Pending lifecycle will emit lifecycle_complete'],
    ['generation-safe origin/main build and activation', 'reload --health-timeout 120000'],
  ])('preserves %s', (_behavior, sourceMarker) => {
    expect(script).toContain(sourceMarker);
  });

  it('moves into an independent retrying systemd unit before destructive work', () => {
    const supervision = script.indexOf('OVERDECK_POST_MERGE_DEPLOY_SUPERVISED');
    const reload = script.indexOf('reload --health-timeout 120000');

    expect(supervision).toBeGreaterThanOrEqual(0);
    expect(supervision).toBeLessThan(reload);
    expect(script).toContain('--property=Restart=on-failure');
    expect(script).toContain('--property=StartLimitIntervalSec=0');
  });

  it('uses the generation-safe reload door instead of staging into the live checkout', () => {
    expect(script).toContain('reload --health-timeout 120000');
    expect(script).toContain('git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir');
    expect(script).toContain('OVERDECK_RESTART_INITIATOR=merge-step0');
    expect(script).not.toContain('mv "$REPO_ROOT/dist"');
    expect(script).not.toContain('npm link');
    expect(script).not.toContain('restart --dashboard --resume');
    expect(script).not.toContain('fuser -k');
    expect(script).not.toContain('setsid "$NODE" dist/dashboard/server.js');
  });
});

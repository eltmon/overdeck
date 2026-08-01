import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/post-merge-deploy.sh');
const script = readFileSync(scriptPath, 'utf8');

describe('post-merge deploy restart handoff', () => {
  it('moves into an independent retrying systemd unit before destructive work', () => {
    const supervision = script.indexOf('OVERDECK_POST_MERGE_DEPLOY_SUPERVISED');
    const build = script.indexOf('Fetching origin/main');

    expect(supervision).toBeGreaterThanOrEqual(0);
    expect(supervision).toBeLessThan(build);
    expect(script).toContain('--property=Restart=on-failure');
    expect(script).toContain('--property=StartLimitIntervalSec=0');
  });

  it('uses the shared restart door instead of killing dashboard and supervisor ports itself', () => {
    expect(script).toContain('restart --dashboard --resume');
    expect(script).toContain('git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir');
    expect(script).toContain('OVERDECK_RESTART_INITIATOR=merge-step0');
    expect(script).not.toContain('fuser -k');
    expect(script).not.toContain('setsid "$NODE" dist/dashboard/server.js');
  });
});

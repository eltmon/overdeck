import { describe, it, expect } from 'vitest';

import { checkSystemPrerequisites, PREREQUISITES } from '../system-prerequisites.js';

// PAN-774: host-tool setup checklist served by GET /api/prerequisites.

describe('checkSystemPrerequisites', () => {
  it('reports found tools with their first version line', async () => {
    const report = await checkSystemPrerequisites(async (cmd) => `${cmd} 1.2.3\nextra noise\n`);

    expect(report.allRequiredFound).toBe(true);
    expect(report.checks).toHaveLength(PREREQUISITES.length);
    const tmux = report.checks.find((check) => check.id === 'tmux');
    expect(tmux).toMatchObject({ found: true, version: 'tmux 1.2.3', required: true });
  });

  it('flags missing required tools and keeps optional misses non-blocking', async () => {
    const report = await checkSystemPrerequisites(async (cmd) => {
      if (cmd === 'tmux') throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
      if (cmd === 'docker') throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
      return `${cmd} 9.9.9`;
    });

    expect(report.allRequiredFound).toBe(false);
    expect(report.checks.find((check) => check.id === 'tmux')).toMatchObject({ found: false, version: null });
    expect(report.checks.find((check) => check.id === 'docker')).toMatchObject({ found: false, required: false });

    const onlyOptionalMissing = await checkSystemPrerequisites(async (cmd) => {
      if (cmd === 'docker' || cmd === 'codex') throw new Error('ENOENT');
      return `${cmd} 9.9.9`;
    });
    expect(onlyOptionalMissing.allRequiredFound).toBe(true);
  });

  it('every prerequisite carries per-platform install hints', () => {
    for (const definition of PREREQUISITES) {
      expect(definition.install.linux.length).toBeGreaterThan(0);
      expect(definition.install.mac.length).toBeGreaterThan(0);
      expect(definition.install.win.length).toBeGreaterThan(0);
      expect(definition.purpose.length).toBeGreaterThan(0);
    }
  });
});

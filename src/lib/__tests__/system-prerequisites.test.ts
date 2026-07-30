import { describe, it, expect } from 'vitest';

import { collectSetupDiagnostics, checkSystemPrerequisites, PREREQUISITES } from '../system-prerequisites.js';

// PAN-774: host-tool setup checklist served by GET /api/prerequisites.

describe('checkSystemPrerequisites', () => {
  const resolveAll = async (command: string) => `/resolved/bin/${command}`;

  it('probes resolved absolute paths and reports their first version line', async () => {
    const probe = async (cmd: string) => `${cmd.split('/').at(-1)} 1.2.3\nextra noise\n`;
    const report = await checkSystemPrerequisites(probe, resolveAll);

    expect(report.allRequiredFound).toBe(true);
    expect(report.checks).toHaveLength(PREREQUISITES.length);
    const tmux = report.checks.find((check) => check.id === 'tmux');
    expect(tmux).toMatchObject({ found: true, version: 'tmux 1.2.3', required: true });
  });

  it('accepts Claude when the shared resolver finds it outside the server PATH', async () => {
    const resolver = async (command: string) => command === 'claude'
      ? '/home/test/.local/bin/claude'
      : `/usr/bin/${command}`;
    const probe = async (cmd: string) => `${cmd} 1.2.3`;

    const report = await checkSystemPrerequisites(probe, resolver);

    expect(report.checks.find((check) => check.id === 'claude')).toMatchObject({
      found: true,
      version: '/home/test/.local/bin/claude 1.2.3',
    });
  });

  it('routes the Kimi probe through the configured ACP executable resolver', async () => {
    const calls: Array<{ command: string; acpHarness: boolean }> = [];
    const report = await checkSystemPrerequisites(
      async (cmd) => `${cmd} 0.27.0`,
      async (command, options) => {
        calls.push({ command, acpHarness: options?.acpHarness === true });
        return command === 'kimi'
          ? '/opt/kimi configured/bin/kimi'
          : `/usr/bin/${command}`;
      },
    );

    expect(calls).toContainEqual({ command: 'kimi', acpHarness: true });
    expect(report.checks.find((check) => check.id === 'kimi')).toMatchObject({
      found: true,
      version: '/opt/kimi configured/bin/kimi 0.27.0',
    });
  });

  it('flags missing required tools and keeps optional misses non-blocking', async () => {
    const missingTmuxAndDocker = async (command: string) =>
      command === 'tmux' || command === 'docker' ? null : `/resolved/bin/${command}`;
    const report = await checkSystemPrerequisites(
      async (cmd) => `${cmd} 9.9.9`,
      missingTmuxAndDocker,
    );

    expect(report.allRequiredFound).toBe(false);
    expect(report.checks.find((check) => check.id === 'tmux')).toMatchObject({ found: false, version: null });
    expect(report.checks.find((check) => check.id === 'docker')).toMatchObject({ found: false, required: false });

    const onlyOptionalMissing = await checkSystemPrerequisites(
      async (cmd) => `${cmd} 9.9.9`,
      async (command) => command === 'docker' || command === 'codex' ? null : `/resolved/bin/${command}`,
    );
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

  it('lists the Kimi Code CLI prerequisite exactly once, covering both native and ACP harnesses (PAN-1837 wi10.ac1)', () => {
    const kimiEntries = PREREQUISITES.filter((definition) => definition.id === 'kimi');
    expect(kimiEntries).toHaveLength(1);
    expect(kimiEntries[0]?.purpose).toContain('native (kimi-code)');
    expect(kimiEntries[0]?.purpose).toContain('ACP (acp)');
  });
});

describe('collectSetupDiagnostics', () => {
  it('reports Kimi from the same configured ACP executable used for launch', async () => {
    const report = await collectSetupDiagnostics(
      '9.8.7',
      async (cmd) => `${cmd} 0.27.0`,
      async (command, options) => command === 'kimi' && options?.acpHarness
        ? '/opt/kimi configured/bin/kimi'
        : `/usr/bin/${command}`,
    );

    expect(report.markdown).toContain(
      '✓ kimi: /opt/kimi configured/bin/kimi 0.27.0 — /opt/kimi configured/bin/kimi',
    );
  });

  it('produces a bounded support report without dumping environment secrets', async () => {
    const previousSecret = process.env['OVERDECK_DIAGNOSTIC_TEST_SECRET'];
    process.env['OVERDECK_DIAGNOSTIC_TEST_SECRET'] = 'must-not-appear';
    try {
      const report = await collectSetupDiagnostics('9.8.7');
      expect(report.schemaVersion).toBe(1);
      expect(report.markdown).toContain('## Overdeck setup diagnostics');
      expect(report.markdown).toContain('Overdeck: 9.8.7');
      expect(report.markdown).toContain('### Prerequisites');
      expect(report.markdown).toContain('### Claude lookup');
      expect(report.markdown).not.toContain('must-not-appear');
      expect(report.markdown.length).toBeLessThanOrEqual(16_384);
    } finally {
      if (previousSecret === undefined) delete process.env['OVERDECK_DIAGNOSTIC_TEST_SECRET'];
      else process.env['OVERDECK_DIAGNOSTIC_TEST_SECRET'] = previousSecret;
    }
  });
});

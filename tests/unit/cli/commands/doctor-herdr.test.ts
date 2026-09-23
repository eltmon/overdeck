import { describe, expect, it } from 'vitest';

import { checkHerdr, type HerdrDoctorDeps } from '../../../../src/cli/commands/doctor-herdr.js';
import { parseHerdrStatus, type HerdrStatus } from '../../../../src/lib/herdr-setup/status.js';
import { parseIntegrationStatus } from '../../../../src/lib/herdr-setup/integrations.js';
import {
  INTEGRATION_STATUS_TEXT,
  STATUS_RUNNING_JSON,
  integrationStatusAllInstalled,
} from '../../lib/herdr-setup/fixtures.js';

const HOME = '/home/op';
const BINARY = '/home/op/.local/bin/herdr';
const SOCKET = '/home/op/.config/herdr/sessions/overdeck/herdr.sock';
const RUNNING = parseHerdrStatus(STATUS_RUNNING_JSON) as HerdrStatus;

const OVERDECK_SETTINGS = JSON.stringify({
  hooks: {
    SessionStart: [
      { matcher: '', hooks: [{ type: 'command', command: '/home/op/.claude/hooks/herdr-agent-state.sh' }] },
      { matcher: '.*', hooks: [{ type: 'command', command: '/home/op/.overdeck/bin/session-start-hook' }] },
    ],
  },
});

function deps(overrides: Partial<HerdrDoctorDeps> = {}): Partial<HerdrDoctorDeps> {
  return {
    home: HOME,
    selection: { backend: 'herdr', source: 'default', diagnostic: 'Herdr is the default terminal backend.' },
    probe: { binary: BINARY, session: 'overdeck', socket: SOCKET, socketExists: true, available: true },
    status: RUNNING,
    configText: 'onboarding = false\n\n[session]\nresume_agents_on_restore = false\n',
    configPath: '/home/op/.config/herdr/config.toml',
    // Pilot integrations installed; the session-identity ones are not.
    integrationRows: parseIntegrationStatus(integrationStatusAllInstalled())
      .map((row) => (['claude', 'codex', 'hermes'].includes(row.target)
        ? { ...row, state: 'not-installed' as const, detail: 'not installed' }
        : row)),
    claudeSettingsText: OVERDECK_SETTINGS,
    systemdAvailable: true,
    unitActive: true,
    kimiVersion: '2.0.1',
    resolveBinary: async (name) => `/usr/bin/${name}`,
    pathEnv: '/home/op/.local/bin:/usr/bin',
    ...overrides,
  };
}

function row(rows: Awaited<ReturnType<typeof checkHerdr>>, name: string) {
  const found = rows.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no row ${name}: ${rows.map((r) => r.name).join(', ')}`);
  return found;
}

describe('checkHerdr (PAN-3956 W9)', () => {
  it('reports a healthy host: five row kinds, seven integration rows, all ok', async () => {
    const rows = await checkHerdr(deps());
    expect(rows.map((r) => r.name)).toEqual([
      'Terminal backend',
      'Herdr binary',
      'Herdr server',
      'Herdr config',
      'Herdr integration: pi',
      'Herdr integration: omp',
      'Herdr integration: claude',
      'Herdr integration: codex',
      'Herdr integration: kimi',
      'Herdr integration: opencode',
      'Herdr integration: hermes',
    ]);
    expect(rows.filter((r) => r.status !== 'ok')).toEqual([]);
    expect(row(rows, 'Terminal backend').message).toBe(`herdr (default) — session overdeck, socket ${SOCKET}`);
    expect(row(rows, 'Herdr binary').message).toBe(`0.9.1 at ${BINARY} (channel stable)`);
    expect(row(rows, 'Herdr server').message)
      .toBe('running 0.9.1, protocol 22, endpoint compatible, unit overdeck-herdr.service active');
    expect(row(rows, 'Herdr config').message).toBe('resume_agents_on_restore = false (~/.config/herdr/config.toml)');
    expect(row(rows, 'Herdr integration: codex').message).toContain('not managed by Overdeck');
  });

  it('is an error naming pan install when herdr is selected but unavailable', async () => {
    const rows = await checkHerdr(deps({
      probe: {
        binary: null,
        session: 'overdeck',
        socket: SOCKET,
        socketExists: false,
        available: false,
        reason: "The 'herdr' binary is not on PATH or in ~/.local/bin.",
      },
      status: null,
    }));
    const backend = row(rows, 'Terminal backend');
    expect(backend.status).toBe('error');
    expect(backend.message).toContain('herdr selected but unavailable');
    expect(backend.fix).toBe('Run: pan install');
    expect(row(rows, 'Herdr binary').status).toBe('error');
  });

  it('emits a single ok row under explicit tmux', async () => {
    const rows = await checkHerdr({
      selection: { backend: 'tmux', source: 'config', diagnostic: "terminal.backend is set to 'tmux' in config.yaml." },
    });
    expect(rows).toEqual([{ name: 'Terminal backend', status: 'ok', message: 'tmux (explicit via config.yaml)' }]);
  });

  it('is an error when resume_agents_on_restore is true or unset', async () => {
    const on = await checkHerdr(deps({ configText: '[session]\nresume_agents_on_restore = true\n' }));
    expect(row(on, 'Herdr config')).toMatchObject({ status: 'error', fix: 'Run: pan sync' });
    const unset = await checkHerdr(deps({ configText: 'onboarding = false\n' }));
    expect(row(unset, 'Herdr config').status).toBe('error');
    expect(row(unset, 'Herdr config').message).toContain('defaults to true');
  });

  it('names the exact hand fix when pan sync cannot edit the config safely (review finding 4)', async () => {
    const inline = await checkHerdr(deps({ configText: 'session = { resume_agents_on_restore = true }\n' }));
    expect(row(inline, 'Herdr config').status).toBe('error');
    expect(row(inline, 'Herdr config').fix).toBe(
      'By hand: set `resume_agents_on_restore = false` inside the `session = { … }` inline table in '
      + '~/.config/herdr/config.toml (pan sync cannot edit it safely: `session` is an inline table '
      + '(`session = { … }`), which Overdeck does not rewrite)',
    );
    const broken = await checkHerdr(deps({ configText: '[session\n' }));
    expect(row(broken, 'Herdr config').fix).toMatch(/^By hand: fix the syntax, then add `resume_agents_on_restore = false`/);
    const dotted = await checkHerdr(deps({ configText: 'session.resume_agents_on_restore = true\n' }));
    expect(row(dotted, 'Herdr config').fix).toBe('Run: pan sync');
  });

  it('is an error when a pilot harness is installed but its integration is not', async () => {
    const rows = await checkHerdr(deps({ integrationRows: parseIntegrationStatus(INTEGRATION_STATUS_TEXT) }));
    expect(row(rows, 'Herdr integration: omp')).toMatchObject({ status: 'error', fix: 'Run: pan sync' });
  });

  it('is ok when a pilot harness binary is absent', async () => {
    const rows = await checkHerdr(deps({
      integrationRows: parseIntegrationStatus(INTEGRATION_STATUS_TEXT),
      resolveBinary: async () => null,
    }));
    expect(row(rows, 'Herdr integration: pi')).toMatchObject({ status: 'ok', message: 'not installed (pi not on PATH)' });
  });

  it('checks Overdeck\'s SessionStart hook when the claude integration is installed', async () => {
    const installed = parseIntegrationStatus(integrationStatusAllInstalled());
    const ok = await checkHerdr(deps({ integrationRows: installed }));
    expect(row(ok, 'Herdr integration: claude').status).toBe('ok');
    const missing = await checkHerdr(deps({
      integrationRows: installed,
      claudeSettingsText: JSON.stringify({ hooks: { SessionStart: [] } }),
    }));
    expect(row(missing, 'Herdr integration: claude')).toMatchObject({ status: 'warn', fix: 'Run: pan sync' });
  });

  it('warns when the server needs a restart, and errors when it is down', async () => {
    const stale = parseHerdrStatus(STATUS_RUNNING_JSON.replace('"restart_needed":false', '"restart_needed":true'));
    expect(row(await checkHerdr(deps({ status: stale })), 'Herdr server').status).toBe('warn');
    const down = parseHerdrStatus(STATUS_RUNNING_JSON.replace('"running":true', '"running":false'));
    expect(row(await checkHerdr(deps({ status: down })), 'Herdr server')).toMatchObject({ status: 'error' });
  });

  it('warns when the server runs outside its unit on a systemd host', async () => {
    const rows = await checkHerdr(deps({ unitActive: false }));
    expect(row(rows, 'Herdr server')).toMatchObject({ status: 'warn', fix: 'Run: pan sync' });
  });

  it('does not ask a non-default home for a unit pan sync never installs', async () => {
    const rows = await checkHerdr(deps({
      unitActive: false,
      probe: { binary: BINARY, session: 'overdeck-1a2b3c4d', socket: SOCKET, socketExists: true, available: true },
    }));
    expect(row(rows, 'Herdr server').status).toBe('ok');
  });

  it('warns with pan sync for an outdated or needs-repair pilot integration', async () => {
    const rows = await checkHerdr(deps({
      integrationRows: parseIntegrationStatus('pi: needs repair (/p)\nkimi: outdated (v1 < v2)\n'),
    }));
    expect(row(rows, 'Herdr integration: pi')).toMatchObject({ status: 'warn', fix: 'Run: pan sync' });
    expect(row(rows, 'Herdr integration: kimi')).toMatchObject({ status: 'warn', fix: 'Run: pan sync' });
  });

  it('warns, without a fix pan sync cannot deliver, when status is unreadable or a target is unlisted', async () => {
    const unreadable = await checkHerdr(deps({ integrationRows: [] }));
    expect(unreadable.filter((r) => r.status === 'error')).toEqual([]);
    expect(row(unreadable, 'Herdr integration: pi')).toEqual({
      name: 'Herdr integration: pi',
      status: 'warn',
      message: 'status unknown: `herdr integration status` gave no readable output',
    });
    expect(row(unreadable, 'Herdr integration: codex').status).toBe('ok');

    const unlisted = await checkHerdr(deps({ integrationRows: parseIntegrationStatus('pi: current (/p)\n') }));
    expect(row(unlisted, 'Herdr integration: kimi')).toEqual({
      name: 'Herdr integration: kimi',
      status: 'warn',
      message: 'status unknown: not listed by `herdr integration status`',
    });
  });

  it('warns when herdr resolves only from ~/.local/bin and that dir is not on PATH', async () => {
    const rows = await checkHerdr(deps({ pathEnv: '/usr/bin' }));
    expect(row(rows, 'Herdr binary')).toMatchObject({ status: 'warn', fix: 'Add ~/.local/bin to PATH' });
  });
});

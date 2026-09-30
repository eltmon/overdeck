/**
 * PAN-2444 O4: SageOx launch wiring with injected layers, git root, probe and
 * upload flag; the `.sageox/` check runs against a real temp dir.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillOverrideLayers } from '../../skill-overrides/resolve.js';
import type { OxProbeResult } from '../probe.js';
import { resolveSageoxLaunch, SAGEOX_CLAUDE_EVENTS, type SageoxLaunchDeps } from '../launch.js';

let root: string;
const ctx = () => ({ cwd: join(root, 'src'), issueId: 'OSS-1' });

const packOn: SkillOverrideLayers = { global: {}, packs: { global: {}, project: { sageox: true } } };
const packOff: SkillOverrideLayers = { global: {}, packs: { global: { sageox: false } } };

function deps(overrides: Partial<SageoxLaunchDeps> & { layers?: SkillOverrideLayers; probeResult?: OxProbeResult; upload?: boolean } = {}): SageoxLaunchDeps {
  return {
    loadLayers: async () => ({ layers: overrides.layers ?? packOn, projectKey: 'oss' }),
    gitRoot: async () => root,
    probe: async () => overrides.probeResult ?? { ok: true, version: '0.19.0', commit: 'abc' },
    readUpload: async () => overrides.upload ?? false,
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sageox-launch-'));
  mkdirSync(join(root, '.sageox'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveSageoxLaunch', () => {
  it('is inactive and silent when the pack is off', async () => {
    let probed = false;
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({
      layers: packOff,
      probe: async () => { probed = true; return { ok: true, version: '', commit: '' }; },
    }));
    expect(result).toEqual({ active: false, warnings: [] });
    expect(probed).toBe(false);
  });

  it('is inactive with a warning when .sageox/ is missing at the git root', async () => {
    rmSync(join(root, '.sageox'), { recursive: true });
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps());
    expect(result.active).toBe(false);
    expect(result.settings).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringContaining(`no .sageox/ at ${root}`)]);
  });

  it('is inactive with a warning when the cwd is not in a git repo', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ gitRoot: async () => null }));
    expect(result).toMatchObject({ active: false, warnings: [expect.stringContaining('not in a git repository')] });
  });

  it('is inactive with a warning when the host contract probe fails', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ probeResult: { ok: false, reason: 'no-contract' } }));
    expect(result).toEqual({
      active: false,
      warnings: ['[launcher] WARNING: SageOx not applied: ox host contract probe failed (no-contract); see pan doctor'],
    });
  });

  it('wires env and six hooks with uploads off by default', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps());
    expect(result.active).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.settings?.env).toEqual({
      OX_HOST_MANAGED: '1',
      OX_PROJECT_ROOT: root,
      OX_HOST_NETWORK: 'off',
      OX_SESSION_PUBLISHING: 'manual',
      SAGEOX_TELEMETRY: 'false',
      SAGEOX_FRICTION: 'false',
      SAGEOX_DAEMON: 'false',
      OX_NO_DAEMON: '1',
    });
    const hooks = result.settings?.hooks ?? {};
    expect(Object.keys(hooks)).toEqual([...SAGEOX_CLAUDE_EVENTS]);
    for (const event of SAGEOX_CLAUDE_EVENTS) {
      const command = (hooks[event] as Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>)[0]?.hooks[0]?.command ?? '';
      expect(command.startsWith('if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 ')).toBe(true);
      expect(command).toContain(`OX_PROJECT_ROOT=${root} OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual`);
      expect(command).toContain(`AGENT_ENV=claude-code ox agent hook ${event} 2>&1 || true; fi`);
    }
  });

  it('turns the network and publishing on when the project upload flag is enabled', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ upload: true }));
    expect(result.settings?.env).toMatchObject({ OX_HOST_NETWORK: 'on', OX_SESSION_PUBLISHING: 'auto' });
  });

  it('activates on a per-skill sageox override without the pack toggle', async () => {
    const layers: SkillOverrideLayers = { global: {}, issue: { 'sageox/sageox': true }, packs: { global: {} } };
    expect((await resolveSageoxLaunch(ctx(), 'claude-code', deps({ layers }))).active).toBe(true);
    const narrowedOff: SkillOverrideLayers = { global: { 'sageox/sageox': true }, issue: { 'sageox/sageox': false }, packs: { global: {} } };
    expect((await resolveSageoxLaunch(ctx(), 'claude-code', deps({ layers: narrowedOff }))).active).toBe(false);
  });

  it('never wires Codex and warns when the pack would have been on', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'codex', deps());
    expect(result).toEqual({
      active: false,
      warnings: ['[launcher] WARNING: SageOx is on but supports Claude Code launches only; sageox skills and hooks not applied'],
    });
    expect(await resolveSageoxLaunch(ctx(), 'codex', deps({ layers: packOff }))).toEqual({ active: false, warnings: [] });
  });

  it('single-quotes a git root that needs shell quoting', async () => {
    const quoted = join(root, "it's here");
    mkdirSync(join(quoted, '.sageox'), { recursive: true });
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ gitRoot: async () => quoted }));
    const command = (result.settings?.hooks['Stop'] as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]?.command;
    expect(command).toContain(`OX_PROJECT_ROOT='${root}/it'\\''s here'`);
  });

  it('drops SageOx, not the launch, when a dependency throws', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ loadLayers: async () => { throw new Error('projects.yaml unreadable'); } }));
    expect(result).toEqual({ active: false, warnings: ['[launcher] WARNING: SageOx not applied: projects.yaml unreadable'] });
  });
});

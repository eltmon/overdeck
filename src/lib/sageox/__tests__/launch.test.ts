/**
 * PAN-2444 O4: SageOx launch wiring with injected layers, git root, probe and
 * upload flag; the `.sageox/` check runs against a real temp dir.
 * PAN-4852 WI-7: the probe and hooks use the built `ox` by absolute path.
 * PAN-4852 WI-13: placement and switch-off are injected and recorded.
 * PAN-4852 WI-17: Codex launches resolve like Claude Code launches.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillOverrideLayers } from '../../skill-overrides/resolve.js';
import type { OxBinary } from '../binary.js';
import type { OxProbeResult } from '../probe.js';
import { oxHookCommand, resolveSageoxLaunch, SAGEOX_CLAUDE_EVENTS, type SageoxLaunchDeps } from '../launch.js';

let root: string;
const ctx = () => ({ cwd: join(root, 'src'), issueId: 'OSS-1' });

const packOn: SkillOverrideLayers = { global: {}, packs: { global: {}, project: { sageox: true } } };
const packOff: SkillOverrideLayers = { global: {}, packs: { global: { sageox: false } } };
const BIN = '/home/u/.overdeck/packs/sageox/abc/bin/ox';
const built: OxBinary = { ok: true, bin: BIN, binDir: '/home/u/.overdeck/packs/sageox/abc/bin', commit: 'abc' };

let placeCalls: Array<[string, string]>;
let removeCalls: string[];

function deps(overrides: Partial<SageoxLaunchDeps> & { layers?: SkillOverrideLayers; probeResult?: OxProbeResult; upload?: boolean } = {}): SageoxLaunchDeps {
  return {
    loadLayers: async () => ({ layers: overrides.layers ?? packOn, projectKey: 'oss' }),
    gitRoot: async () => root,
    resolveBinary: async () => built,
    probe: async () => overrides.probeResult ?? { ok: true, version: '0.19.0', commit: 'abc' },
    readUpload: async () => overrides.upload ?? false,
    place: async (placeRoot, projectKey) => { placeCalls.push([placeRoot, projectKey]); return { ok: true, state: 'placed' }; },
    removePlacement: async cwd => { removeCalls.push(cwd); return { removed: [] }; },
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sageox-launch-'));
  placeCalls = [];
  removeCalls = [];
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

  it('removes a placed binding from the cwd when SageOx is off and returns no settings', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({
      layers: packOff,
      removePlacement: async cwd => { removeCalls.push(cwd); return { removed: ['config.json', 'README.md'] }; },
    }));
    expect(result).toEqual({ active: false, warnings: [] });
    expect(result.settings).toBeUndefined();
    expect(removeCalls).toEqual([ctx().cwd]);
    expect(placeCalls).toEqual([]);
  });

  it('turns a switch-off failure into one warning', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({
      layers: packOff,
      removePlacement: async () => { throw new Error('EACCES: permission denied'); },
    }));
    expect(result).toEqual({
      active: false,
      warnings: ['[launcher] WARNING: SageOx placed files not removed: EACCES: permission denied'],
    });
  });

  it('places the binding at the git root, then returns settings, when SageOx is on', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps());
    expect(result.active).toBe(true);
    expect(result.settings?.env.OX_PROJECT_ROOT).toBe(root);
    expect(placeCalls).toEqual([[root, 'oss']]);
    expect(removeCalls).toEqual([]);
  });

  it('is inactive with the link warning when the project has no binding', async () => {
    const warning = 'SageOx not applied: project oss has no SageOx link; run pan skills pack sageox link --project oss';
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ place: async () => ({ ok: false, warning }) }));
    expect(result).toEqual({ active: false, warnings: [`[launcher] WARNING: ${warning}`] });
  });

  it('drops SageOx with one warning when placement throws', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ place: async () => { throw new Error('ENOSPC: no space left on device'); } }));
    expect(result).toEqual({ active: false, warnings: ['[launcher] WARNING: SageOx not applied: ENOSPC: no space left on device'] });
  });

  it('is inactive with a warning and places nothing when the launch has no project', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ loadLayers: async () => ({ layers: packOn }) }));
    expect(result).toEqual({ active: false, warnings: ['[launcher] WARNING: SageOx not applied: the launch has no project'] });
    expect(placeCalls).toEqual([]);
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
    expect(placeCalls).toEqual([]);
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
      expect(command.startsWith(`if [ -x ${BIN} ]; then OX_HOST_MANAGED=1 `)).toBe(true);
      expect(command).toContain(`OX_PROJECT_ROOT=${root} OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual`);
      expect(command).toContain(`AGENT_ENV=claude-code ${BIN} agent hook ${event} 2>&1 || true; fi`);
      expect(command).not.toContain('command -v ox');
    }
  });

  it('probes the built ox by its absolute path', async () => {
    const probed: string[] = [];
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({
      probe: async bin => { probed.push(bin); return { ok: true, version: '0.25.0', commit: '' }; },
    }));
    expect(result.active).toBe(true);
    expect(probed).toEqual([BIN]);
  });

  it('is inactive with one warning naming the sync command when ox is not built', async () => {
    let probed = false;
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({
      resolveBinary: async () => ({
        ok: false,
        reason: 'not-built',
        commit: 'abc1234def',
        message: 'ox is not built for the sageox pack (abc1234); run pan skills pack sync sageox',
      }),
      probe: async () => { probed = true; return { ok: true, version: '', commit: '' }; },
    }));
    expect(result).toEqual({
      active: false,
      warnings: ['[launcher] WARNING: SageOx not applied: ox is not built for the sageox pack (abc1234); run pan skills pack sync sageox'],
    });
    expect(probed).toBe(false);
    expect(placeCalls).toEqual([]);
  });

  it('quotes a built ox path that needs shell quoting in the hook command', () => {
    const command = oxHookCommand("/home/o'k/bin/ox", { OX_HOST_MANAGED: '1' }, 'codex', 'SessionStart');
    expect(command).toBe(
      `if [ -x '/home/o'\\''k/bin/ox' ]; then OX_HOST_MANAGED=1 AGENT_ENV=codex '/home/o'\\''k/bin/ox' agent hook SessionStart 2>&1 || true; fi`,
    );
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

  it('wires Codex like Claude Code and returns the built ox for its hooks (WI-17)', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'codex', deps());
    expect(result.active).toBe(true);
    expect(result.bin).toBe(BIN);
    expect(result.warnings).toEqual([]);
    expect(placeCalls).toEqual([[root, 'oss']]);
    expect(await resolveSageoxLaunch(ctx(), 'codex', deps({ layers: packOff }))).toEqual({ active: false, warnings: [] });
  });

  it('single-quotes a git root that needs shell quoting', async () => {
    const quoted = join(root, "it's here");
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ gitRoot: async () => quoted }));
    const command = (result.settings?.hooks['Stop'] as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]?.command;
    expect(command).toContain(`OX_PROJECT_ROOT='${root}/it'\\''s here'`);
  });

  it('drops SageOx, not the launch, when a dependency throws', async () => {
    const result = await resolveSageoxLaunch(ctx(), 'claude-code', deps({ loadLayers: async () => { throw new Error('projects.yaml unreadable'); } }));
    expect(result).toEqual({ active: false, warnings: ['[launcher] WARNING: SageOx not applied: projects.yaml unreadable'] });
  });
});

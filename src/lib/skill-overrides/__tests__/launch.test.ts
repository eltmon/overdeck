import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSkillOverrideLayers, listPackCatalog, overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-launch-home-'));
  process.env.OVERDECK_HOME = home;
  return { loadSkillOverrideLayers: vi.fn(), listPackCatalog: vi.fn(), overdeckHome: home };
});

vi.mock('../store.js', () => ({ loadSkillOverrideLayers }));
vi.mock('../catalog.js', () => ({ listPackCatalog }));
vi.mock('../../projects.js', () => ({ resolveProjectKeyForCwdAsync: vi.fn(async () => 'proj') }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile), spawn: vi.fn(actual.spawn) };
});

import { packExtractDir } from '../../skill-packs/sources.js';
import {
  applyClaudePacks,
  applyCodexPacks,
  CODEX_SKILL_BLOCK_BEGIN,
  CODEX_SKILL_BLOCK_END,
  claudeSkillSettingsJson,
  resolveLaunchDisabledSkills,
  writeCodexSkillOverrides,
} from '../launch.js';
import { DEFT_CLI_DENY } from '../../deft/launch.js';
import {
  claudeSkillPluginDirArg,
  claudeSkillSettingsArg,
  deftEnvReadLine,
  launcherSkillOverrideLines,
} from '../launcher-lines.js';

describe('claudeSkillSettingsJson', () => {
  it('maps every disabled skill to off', () => {
    expect(JSON.parse(claudeSkillSettingsJson(['grilling', 'domain-modeling'])))
      .toEqual({ skillOverrides: { grilling: 'off', 'domain-modeling': 'off' } });
  });

  it('returns an empty string when nothing is disabled', () => {
    expect(claudeSkillSettingsJson([])).toBe('');
    expect(claudeSkillSettingsJson([], { deny: [] })).toBe('');
  });

  it('adds permissions.deny for the Deft CLI list as one JSON object (PAN-3943)', () => {
    const json = claudeSkillSettingsJson([], { deny: DEFT_CLI_DENY });
    expect(JSON.parse(json)).toEqual({ permissions: { deny: [...DEFT_CLI_DENY] } });
    expect(JSON.parse(claudeSkillSettingsJson(['grilling'], { deny: ['Bash(deft:*)'] }))).toEqual({
      skillOverrides: { grilling: 'off' },
      permissions: { deny: ['Bash(deft:*)'] },
    });
    // The launcher's stdout guard keeps only '' or one `{…}` object.
    const guard = execFileSync('bash', ['-c', `case "$1" in ''|'{'*'}') echo keep ;; *) echo drop ;; esac`, '_', json], {
      encoding: 'utf8',
    });
    expect(guard).toBe('keep\n');
  });

  it('merges SageOx env and hooks into one single-line object (PAN-2444)', () => {
    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 ox agent hook Stop; fi' }] }] };
    const json = claudeSkillSettingsJson(['grilling'], { env: { OX_HOST_MANAGED: '1' }, hooks });
    expect(json).not.toContain('\n');
    expect(JSON.parse(json)).toEqual({ skillOverrides: { grilling: 'off' }, env: { OX_HOST_MANAGED: '1' }, hooks });
    expect(JSON.parse(claudeSkillSettingsJson([], { env: { OX_HOST_MANAGED: '1' }, hooks }))).toEqual({ env: { OX_HOST_MANAGED: '1' }, hooks });
    expect(claudeSkillSettingsJson([], { env: {}, hooks: {} })).toBe('');
  });

  it('carries SageOx env and the Deft deny list together (PAN-2444 + PAN-3943)', () => {
    const json = claudeSkillSettingsJson([], { env: { OX_HOST_MANAGED: '1' }, deny: ['Bash(deft:*)'] });
    expect(json).not.toContain('\n');
    expect(JSON.parse(json)).toEqual({ env: { OX_HOST_MANAGED: '1' }, permissions: { deny: ['Bash(deft:*)'] } });
  });
});

describe('writeCodexSkillOverrides', () => {
  let codexHome: string;
  const configPath = () => join(codexHome, 'config.toml');

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), 'codex-skill-home-'));
    await writeFile(configPath(), '# Overdeck-managed Codex config\napproval_policy = "never"\n\n[notice]\nhide_rate_limit_model_nudge = true\n');
  });

  afterEach(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  it('appends a marked block after the existing config', async () => {
    await writeCodexSkillOverrides(codexHome, ['grilling']);
    const text = await readFile(configPath(), 'utf8');
    expect(text).toContain('approval_policy = "never"');
    expect(text.endsWith(
      `${CODEX_SKILL_BLOCK_BEGIN}\n[[skills.config]]\nname = "grilling"\nenabled = false\n${CODEX_SKILL_BLOCK_END}\n`,
    )).toBe(true);
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('replaces the block in place with a different list and is idempotent', async () => {
    await writeCodexSkillOverrides(codexHome, ['grilling']);
    await writeCodexSkillOverrides(codexHome, ['codebase-design', 'domain-modeling']);
    const once = await readFile(configPath(), 'utf8');
    await writeCodexSkillOverrides(codexHome, ['codebase-design', 'domain-modeling']);
    const twice = await readFile(configPath(), 'utf8');

    expect(twice).toBe(once);
    expect(once.split(CODEX_SKILL_BLOCK_BEGIN)).toHaveLength(2);
    expect(once).not.toContain('"grilling"');
    expect(once).toContain('name = "codebase-design"');
    expect(once).toContain('name = "domain-modeling"');
  });

  it('removes the block when the list becomes empty', async () => {
    const original = await readFile(configPath(), 'utf8');
    await writeCodexSkillOverrides(codexHome, ['grilling']);
    await writeCodexSkillOverrides(codexHome, []);
    expect(await readFile(configPath(), 'utf8')).toBe(original);
  });

  it('creates config.toml when it is missing and escapes TOML strings', async () => {
    await rm(configPath());
    await writeCodexSkillOverrides(codexHome, ['we"ird\\name']);
    expect(await readFile(configPath(), 'utf8')).toContain('name = "we\\"ird\\\\name"');
  });
});

describe('resolveLaunchDisabledSkills', () => {
  beforeEach(() => {
    loadSkillOverrideLayers.mockReset();
    loadSkillOverrideLayers.mockResolvedValue({ global: { grilling: false, 'pan-done': false }, issue: { zeta: false } });
  });

  it('derives the issue from a workspace cwd and returns the disabled names', async () => {
    const disabled = await resolveLaunchDisabledSkills({ cwd: '/repo/workspaces/feature-pan-1' });
    expect(loadSkillOverrideLayers).toHaveBeenCalledWith({ projectKey: 'proj', issueId: 'PAN-1' });
    expect(disabled).toEqual(['grilling', 'zeta']);
  });

  it('prefers an explicit issue id', async () => {
    await resolveLaunchDisabledSkills({ cwd: '/repo/workspaces/feature-pan-1', issueId: 'PAN-7' });
    expect(loadSkillOverrideLayers).toHaveBeenCalledWith({ projectKey: 'proj', issueId: 'PAN-7' });
  });
});

describe('launcherSkillOverrideLines', () => {
  it('quotes a working dir with a space and omits --issue when none', () => {
    const [line] = launcherSkillOverrideLines({ harness: 'claude-code', workingDir: '/tmp/my project' });
    expect(line).toContain(`--cwd '/tmp/my project'`);
    expect(line).not.toContain('--issue');
    expect(line).toContain('PAN_SKILL_SETTINGS=');
  });

  it('passes --issue and the codex home for codex, then reads the Deft env file', () => {
    const [line, deft] = launcherSkillOverrideLines({ harness: 'codex', workingDir: '/w', issueId: 'PAN-1' });
    expect(line).toBe(
      `pan skills launch-settings --harness codex --cwd '/w' --issue 'PAN-1' --codex-home "$CODEX_HOME" || echo "[launcher] WARNING: skill overrides not applied" >&2`,
    );
    expect(deft).toBe(deftEnvReadLine('"$CODEX_HOME/overdeck-deft.env"'));
  });

  it('exports only the two allowlisted Deft assignments and never sources the file (PAN-3943)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deft-env-'));
    const file = join(dir, 'deft.env');
    const canary = join(dir, 'pwned');
    const report = `printf '%s|%s|%s' "\${DEFT_DIRECTIVE_DISABLE-unset}" "\${DEFT_ORCHESTRATOR-unset}" "\${EVIL-unset}"`;
    const read = (): string =>
      execFileSync('bash', ['-c', `${deftEnvReadLine(`'${file}'`)}\n${report}`], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
      });
    try {
      expect(read()).toBe('unset|unset|unset');
      await writeFile(
        file,
        ['EVIL=1', 'DEFT_ORCHESTRATOR=other', `DEFT_DIRECTIVE_DISABLE=1; touch '${canary}'`, `$(touch '${canary}')`, ''].join('\n'),
      );
      expect(read()).toBe('unset|unset|unset');
      await writeFile(file, 'DEFT_DIRECTIVE_DISABLE=1\nDEFT_ORCHESTRATOR=overdeck\n');
      expect(read()).toBe('1|overdeck|unset');
      expect(existsSync(canary)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const runStep = (panBody: string): string => {
    const lines = launcherSkillOverrideLines({ harness: 'claude-code', workingDir: '/w' });
    const script = `pan() { ${panBody} }\n${lines.join('\n')}\nprintf '[%s]' "$PAN_SKILL_SETTINGS"`;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };

  it('fails open in bash when pan exits non-zero', () => {
    expect(runStep('echo partial; return 3;')).toBe('[]');
  });

  it('fails open when pan exits zero but prints something other than one JSON object', () => {
    expect(runStep(`echo 'update available'; echo '{"a":1}';`)).toBe('[]');
    expect(runStep(`echo '{"a":1}'; echo 'trailing notice';`)).toBe('[]');
  });

  it('keeps empty output and a JSON object', () => {
    expect(runStep('return 0;')).toBe('[]');
    expect(runStep(`echo '{"skillOverrides":{"grilling":"off"}}';`)).toBe('[{"skillOverrides":{"grilling":"off"}}]');
  });

  it('adds the plugin link step as the third line for Claude (PAN-4334)', () => {
    const lines = launcherSkillOverrideLines({ harness: 'claude-code', workingDir: '/w', pluginLink: '/h/launch/k/skill-packs' });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(`--cwd '/w' --plugin-link '/h/launch/k/skill-packs')"`);
    expect(lines[1]).toMatch(/^case "\$PAN_SKILL_SETTINGS"/);
    expect(lines[2]).toBe(
      `if [ -d '/h/launch/k/skill-packs' ]; then PAN_SKILL_PLUGIN_DIR='/h/launch/k/skill-packs'; else PAN_SKILL_PLUGIN_DIR=''; fi`,
    );
    expect(lines[3]).toBe(deftEnvReadLine(`'/h/launch/k/deft.env'`));
    const codex = launcherSkillOverrideLines({ harness: 'codex', workingDir: '/w', pluginLink: '/h/x' });
    expect(codex.join('\n')).not.toContain('--plugin-link');
  });

  it('expands to --plugin-dir only when the link is a directory', () => {
    const arg = claudeSkillPluginDirArg(true);
    const run = (value: string) => execFileSync('bash', ['-c', `PAN_SKILL_PLUGIN_DIR=${value}; set -- claude${arg}; printf '%s|' "$@"`], { encoding: 'utf8' });
    expect(run(`''`)).toBe('claude|');
    expect(run(`'/h/launch/k/skill-packs'`)).toBe('claude|--plugin-dir|/h/launch/k/skill-packs|');
    expect(claudeSkillPluginDirArg(false)).toBe('');
  });

  it('expands to --settings only when settings were produced', () => {
    const arg = claudeSkillSettingsArg(true);
    const run = (value: string) => execFileSync('bash', ['-c', `PAN_SKILL_SETTINGS=${value}; set -- claude${arg}; printf '%s|' "$@"`], { encoding: 'utf8' });
    expect(run(`''`)).toBe('claude|');
    expect(run(`'{"a":1}'`)).toBe('claude|--settings|{"a":1}|');
    expect(claudeSkillSettingsArg(false)).toBe('');
  });
});

describe('skill pack launch (PAN-4334)', () => {
  const COMMIT = 'd'.repeat(40);
  const link = join(overdeckHome, 'launch', 'agent-1', 'skill-packs');
  const ctx = { cwd: '/repo/workspaces/feature-pan-1' };
  const skill = (name: string, dir: string) => ({ name, dir, description: `${name}.`, optIn: false });
  const catalogEntry = (cached: boolean) => ({
    id: 'mattpocock',
    url: 'https://github.com/mattpocock/skills',
    ref: 'v1.2.3',
    commit: COMMIT,
    adapter: 'claude-plugin',
    cached,
    manifest: cached
      ? {
          skills: [skill('grilling', 'skills/productivity/grilling'), skill('tdd', 'skills/engineering/tdd')],
          capabilities: {
            hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
            executables: [], projectMutatingSkills: [], requiresCli: [],
          },
          license: 'MIT',
          pluginName: 'mattpocock-skills',
        }
      : null,
  });

  beforeEach(() => {
    const root = packExtractDir('mattpocock', COMMIT);
    for (const dir of ['skills/productivity/grilling', 'skills/engineering/tdd']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'SKILL.md'), `---\nname: ${dir.split('/').pop()}\ndescription: x\n---\n`);
    }
    listPackCatalog.mockReset();
    listPackCatalog.mockResolvedValue([catalogEntry(true)]);
    loadSkillOverrideLayers.mockReset();
    vi.mocked(execFile).mockClear();
    vi.mocked(spawn).mockClear();
  });

  afterAll(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('links a mount holding the enabled pack skills', async () => {
    loadSkillOverrideLayers.mockResolvedValue({ global: { 'mattpocock/tdd': false }, packs: { global: { mattpocock: true } } });
    expect(await applyClaudePacks(ctx, link)).toEqual([]);
    expect(readlinkSync(link)).toMatch(/packs\/mounts\/[0-9a-f]{64}\/plugins$/);
    expect(existsSync(join(link, 'mattpocock', 'skills', 'grilling', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(link, 'mattpocock', 'skills', 'tdd'))).toBe(false);
  });

  it('mounts a deft-readonly pack with the host notice transform (PAN-3943)', async () => {
    const dir = 'content/skills/deft-directive-glossary';
    const root = packExtractDir('deft', COMMIT);
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'SKILL.md'), '---\nname: deft-directive-glossary\ndescription: x\n---\n# Glossary\n');
    const base = catalogEntry(true);
    listPackCatalog.mockResolvedValue([
      {
        ...base,
        id: 'deft',
        url: 'https://github.com/eltmon/directive',
        adapter: 'deft-readonly',
        manifest: { ...base.manifest!, skills: [skill('glossary', dir)], pluginName: null },
      },
    ]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { deft: true } } });
    expect(await applyClaudePacks(ctx, link)).toEqual([]);
    const text = await readFile(join(link, 'deft', 'skills', 'glossary', 'SKILL.md'), 'utf8');
    expect(text).toMatch(/^---\nname: glossary\n/);
    expect(text).toContain('<!-- overdeck:deft-host-notice v1 -->');
  });

  it('removes the link when the issue turns the pack off', async () => {
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { mattpocock: true } } });
    await applyClaudePacks(ctx, link);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { mattpocock: true }, issue: { mattpocock: false } } });
    expect(await applyClaudePacks(ctx, link)).toEqual([]);
    expect(() => lstatSync(link)).toThrow();
  });

  it('skips an uncached pack with a warning and runs no git', async () => {
    listPackCatalog.mockResolvedValue([catalogEntry(false)]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { mattpocock: true } } });
    expect(await applyClaudePacks(ctx, link)).toEqual([
      '[launcher] WARNING: skill pack mattpocock not cached; run pan skills pack sync mattpocock',
    ]);
    expect(() => lstatSync(link)).toThrow();
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('leaves an excluded pack out of the mount without a not-cached warning (PAN-2444)', async () => {
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { mattpocock: true } } });
    expect(await applyClaudePacks(ctx, link, new Set(['mattpocock']))).toEqual([]);
    expect(() => lstatSync(link)).toThrow();
    listPackCatalog.mockResolvedValue([catalogEntry(false)]);
    expect(await applyClaudePacks(ctx, link, new Set(['mattpocock']))).toEqual([]);
  });

  it('stays quiet about an uncached pack that nothing turns on', async () => {
    listPackCatalog.mockResolvedValue([catalogEntry(false)]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {} });
    expect(await applyClaudePacks(ctx, link)).toEqual([]);
  });

  it('writes the Codex pack block for the same selection', async () => {
    const codexHome = join(overdeckHome, 'codex-agent');
    loadSkillOverrideLayers.mockResolvedValue({ global: { 'mattpocock/grilling': true } });
    await applyCodexPacks(ctx, codexHome);
    const text = await readFile(join(codexHome, 'config.toml'), 'utf8');
    expect(text).toContain('[plugins."mattpocock@overdeck-packs"]');
    expect(execFile).not.toHaveBeenCalled();
  });
});

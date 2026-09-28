import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSkillOverrideLayers } = vi.hoisted(() => ({ loadSkillOverrideLayers: vi.fn() }));

vi.mock('../store.js', () => ({ loadSkillOverrideLayers }));
vi.mock('../../projects.js', () => ({ resolveProjectKeyForCwdAsync: vi.fn(async () => 'proj') }));

import {
  CODEX_SKILL_BLOCK_BEGIN,
  CODEX_SKILL_BLOCK_END,
  claudeSkillSettingsArg,
  claudeSkillSettingsJson,
  launcherSkillOverrideLines,
  resolveLaunchDisabledSkills,
  writeCodexSkillOverrides,
} from '../launch.js';

describe('claudeSkillSettingsJson', () => {
  it('maps every disabled skill to off', () => {
    expect(JSON.parse(claudeSkillSettingsJson(['grilling', 'domain-modeling'])))
      .toEqual({ skillOverrides: { grilling: 'off', 'domain-modeling': 'off' } });
  });

  it('returns an empty string when nothing is disabled', () => {
    expect(claudeSkillSettingsJson([])).toBe('');
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

  it('passes --issue and the codex home for codex', () => {
    const [line] = launcherSkillOverrideLines({ harness: 'codex', workingDir: '/w', issueId: 'PAN-1' });
    expect(line).toBe(
      `pan skills launch-settings --harness codex --cwd '/w' --issue 'PAN-1' --codex-home "$CODEX_HOME" || echo "[launcher] WARNING: skill overrides not applied" >&2`,
    );
  });

  it('fails open in bash when pan exits non-zero', () => {
    const [line] = launcherSkillOverrideLines({ harness: 'claude-code', workingDir: '/w' });
    const script = `pan() { echo partial; return 3; }\n${line}\nprintf '[%s]' "$PAN_SKILL_SETTINGS"`;
    const result = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(result).toBe('[]');
  });

  it('expands to --settings only when settings were produced', () => {
    const arg = claudeSkillSettingsArg(true);
    const run = (value: string) => execFileSync('bash', ['-c', `PAN_SKILL_SETTINGS=${value}; set -- claude${arg}; printf '%s|' "$@"`], { encoding: 'utf8' });
    expect(run(`''`)).toBe('claude|');
    expect(run(`'{"a":1}'`)).toBe('claude|--settings|{"a":1}|');
    expect(claudeSkillSettingsArg(false)).toBe('');
  });
});

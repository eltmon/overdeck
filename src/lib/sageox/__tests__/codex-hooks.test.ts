/**
 * PAN-4852 WI-17: SageOx hooks for Codex launches — the trust hash matches
 * Codex's own, and `hooks.json` plus the trust block land beside the skill
 * block without breaking `config.toml`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '@iarna/toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_SKILL_BLOCK_BEGIN, writeCodexSkillOverrides } from '../../skill-overrides/launch.js';
import {
  CODEX_TRUST_BLOCK_BEGIN,
  CODEX_TRUST_BLOCK_END,
  codexEventSnake,
  codexHookTrustHash,
  removeSageoxCodexHooks,
  SAGEOX_CODEX_EVENTS,
  writeSageoxCodexHooks,
} from '../codex-hooks.js';
import { sageoxEnv } from '../launch.js';

// The operator's real ~/.codex/hooks.json SessionStart command (PRD 3.4) and the
// trusted_hash Codex 0.159.0 stored for it in ~/.codex/config.toml.
const OPERATOR_SESSION_START = "if [ -f '/home/eltmon/.orca/agent-hooks/codex-hook.sh' ] && [ -r '/home/eltmon/.orca/agent-hooks/codex-hook.sh' ] && [ -x '/home/eltmon/.orca/agent-hooks/codex-hook.sh' ]; then /bin/sh '/home/eltmon/.orca/agent-hooks/codex-hook.sh'; else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi";
const OPERATOR_SESSION_START_HASH = 'sha256:9a9311f083ae0743a51676ae5bae444af736815ebffd02d5c81619ea19db90af';

const BIN = '/home/u/.overdeck/packs/sageox/abc/bin/ox';

// What initCodexHome writes (src/lib/runtimes/codex.ts), without its auth symlink.
const INIT_CONFIG = [
  '# Overdeck-managed Codex config — do not edit manually',
  '# model/provider set at launch via -m flag',
  '',
  'approval_policy = "never"',
  'model_reasoning_effort = "high"',
  '',
  '[notice]',
  'hide_rate_limit_model_nudge = true',
  '',
  '[projects."/home/u/work"]',
  'trust_level = "trusted"',
  '',
].join('\n');

type HooksFile = { hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }>> };

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), 'sageox-codex-hooks-'));
});

afterEach(() => {
  rmSync(codexHome, { recursive: true, force: true });
});

function readHooks(): HooksFile {
  return JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8')) as HooksFile;
}

function readConfig(): string {
  return readFileSync(join(codexHome, 'config.toml'), 'utf8');
}

describe('codexHookTrustHash', () => {
  it('matches the hash Codex stored for the operator SessionStart hook', () => {
    expect(codexHookTrustHash('session_start', OPERATOR_SESSION_START, 10)).toBe(OPERATOR_SESSION_START_HASH);
  });

  it('names events the way Codex keys them', () => {
    expect(SAGEOX_CODEX_EVENTS.map(codexEventSnake)).toEqual(
      ['session_start', 'pre_tool_use', 'post_tool_use', 'user_prompt_submit', 'stop', 'session_end'],
    );
  });
});

describe('writeSageoxCodexHooks', () => {
  it('writes the six events with the built ox, AGENT_ENV=codex and a 3 s SessionEnd timeout', async () => {
    await writeSageoxCodexHooks(codexHome, sageoxEnv('/home/u/work', false), BIN);
    const { hooks } = readHooks();
    expect(Object.keys(hooks)).toEqual([...SAGEOX_CODEX_EVENTS]);
    for (const event of SAGEOX_CODEX_EVENTS) {
      const handler = hooks[event]?.[0]?.hooks[0];
      expect(handler?.type).toBe('command');
      expect(handler?.command).toContain(`${BIN} agent hook ${event}`);
      expect(handler?.command).toContain('AGENT_ENV=codex');
      expect(handler?.timeout).toBe(event === 'SessionEnd' ? 3 : 30);
    }
  });

  it('trusts each written hook under its hooks.json key with the matching hash', async () => {
    await writeSageoxCodexHooks(codexHome, sageoxEnv('/home/u/work', false), BIN);
    const { hooks } = readHooks();
    const state = (parse(readConfig()) as { hooks: { state: Record<string, { trusted_hash: string }> } }).hooks.state;
    const hooksPath = join(realpathSync(codexHome), 'hooks.json');
    expect(Object.keys(state).sort()).toEqual(SAGEOX_CODEX_EVENTS.map(event => `${hooksPath}:${codexEventSnake(event)}:0:0`).sort());
    for (const event of SAGEOX_CODEX_EVENTS) {
      const handler = hooks[event]![0]!.hooks[0]!;
      expect(state[`${hooksPath}:${codexEventSnake(event)}:0:0`]?.trusted_hash)
        .toBe(codexHookTrustHash(codexEventSnake(event), handler.command, handler.timeout));
    }
  });

  it('keys trust by the symlink-resolved hooks.json path, as Codex prints it', async () => {
    const real = join(codexHome, 'real');
    mkdirSync(real);
    const link = join(codexHome, 'link');
    symlinkSync(real, link, 'dir');
    await writeSageoxCodexHooks(link, sageoxEnv('/home/u/work', false), BIN);
    const state = (parse(readFileSync(join(real, 'config.toml'), 'utf8')) as { hooks: { state: Record<string, unknown> } }).hooks.state;
    expect(Object.keys(state)).toContain(`${join(realpathSync(real), 'hooks.json')}:session_start:0:0`);
    expect(Object.keys(state).some(key => key.startsWith(link))).toBe(false);
  });

  it('keeps the skill block, parses as TOML and never writes a bare [hooks.state] header', async () => {
    writeFileSync(join(codexHome, 'config.toml'), INIT_CONFIG);
    await writeCodexSkillOverrides(codexHome, ['pdf']);
    await writeSageoxCodexHooks(codexHome, sageoxEnv('/home/u/work', true), BIN);
    await writeSageoxCodexHooks(codexHome, sageoxEnv('/home/u/work', true), BIN);
    const config = readConfig();
    const parsed = parse(config) as { skills: { config: Array<{ name: string }> }; hooks: { state: Record<string, unknown> }; approval_policy: string };
    expect(parsed.approval_policy).toBe('never');
    expect(parsed.skills.config.map(entry => entry.name)).toEqual(['pdf']);
    expect(Object.keys(parsed.hooks.state)).toHaveLength(6);
    expect(config).toContain(CODEX_SKILL_BLOCK_BEGIN);
    expect(config.split(CODEX_TRUST_BLOCK_BEGIN)).toHaveLength(2);
    expect(config.trimEnd().endsWith(CODEX_TRUST_BLOCK_END)).toBe(true);
    expect(config.split('\n')).not.toContain('[hooks.state]');
  });
});

describe('removeSageoxCodexHooks', () => {
  it('removes hooks.json and the trust block and leaves the skill block intact', async () => {
    writeFileSync(join(codexHome, 'config.toml'), INIT_CONFIG);
    await writeCodexSkillOverrides(codexHome, ['pdf']);
    await writeSageoxCodexHooks(codexHome, sageoxEnv('/home/u/work', false), BIN);
    await removeSageoxCodexHooks(codexHome);
    expect(existsSync(join(codexHome, 'hooks.json'))).toBe(false);
    const config = readConfig();
    expect(config).toContain(CODEX_SKILL_BLOCK_BEGIN);
    expect(config).not.toContain(CODEX_TRUST_BLOCK_BEGIN);
    expect(config).not.toContain('hooks.state');
    expect((parse(config) as { skills: { config: Array<{ name: string }> } }).skills.config.map(entry => entry.name)).toEqual(['pdf']);
  });

  it('is a no-op on a home that never had SageOx hooks', async () => {
    await removeSageoxCodexHooks(codexHome);
    expect(existsSync(join(codexHome, 'hooks.json'))).toBe(false);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(false);
  });
});

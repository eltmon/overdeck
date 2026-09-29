/**
 * PAN-4400 WI-3: the path-scoped preset write door. Apply edits only the
 * plan's change paths, undo restores the replaced values, and every refusal
 * leaves config.yaml byte-identical.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, parseDocument } from 'yaml';

import {
  ConfigChangedError,
  NoPresetUndoError,
  PresetBlockedError,
  PresetPlanStaleError,
  PresetValidationError,
  applyPreset,
  configFileDeps,
  listPresetStatus,
  undoLastPresetApply,
  type PresetApplyDeps,
} from '../../../../src/lib/model-presets/apply.js';
import { planPresetApply } from '../../../../src/lib/model-presets/plan.js';
import { presetStatePath, readPresetState } from '../../../../src/lib/model-presets/state.js';
import type { AuthMode } from '../../../../src/lib/subscription-types.js';

const FIXTURE = [
  '# Overdeck config: hand-edited, keep this comment',
  'custom_block:',
  '  a: 1',
  'api_keys:',
  '  openai: $OPENAI_API_KEY',
  '  anthropic: sk-literal-test',
  'tts:',
  '  summarizer:',
  '    model: gpt-5.4-mini',
  '    batch_window_seconds: 7',
  'memory:',
  '  features:',
  '    knowledge_index: true',
  'roles:',
  '  work:',
  '    harness: claude-code',
  '',
].join('\n');

let home: string;
let configPath: string;
let previousHome: string | undefined;
let previousCwd: string;
let previousOpenAiKey: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4400-apply-'));
  configPath = join(home, 'config.yaml');
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  previousCwd = process.cwd();
  previousOpenAiKey = process.env.OPENAI_API_KEY;
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
  rmSync(home, { recursive: true, force: true });
});

/** `null` means the provider has no credentials (a default parameter would swallow `undefined`). */
function deps(authMode: AuthMode | null = 'subscription'): PresetApplyDeps {
  return {
    ...configFileDeps(configPath),
    hasCredentials: async () => authMode !== null,
    resolveHarnessBinary: async (harness) => `/usr/bin/${harness}`,
    getAuthMode: async () => authMode ?? undefined,
    resolveCodexContext: async () => ({}),
  };
}

async function applyFresh(presetId: string, applyDeps: PresetApplyDeps = deps()) {
  const plan = await planPresetApply(presetId, applyDeps);
  return applyPreset(presetId, { expectedDigest: plan.digest }, applyDeps);
}

function readConfig(): string {
  return readFileSync(configPath, 'utf8');
}

describe('applyPreset', () => {
  it('applies only change paths and leaves other nodes byte-identical', async () => {
    writeFileSync(configPath, FIXTURE);
    const projectDir = mkdtempSync(join(home, 'project-'));
    writeFileSync(join(projectDir, '.pan.yaml'), 'models:\n  default_conversation_model: project-only-model\n');
    process.chdir(projectDir);
    const envSecret = ['env', 'secret', 'value', 'pan4400'].join('-');
    process.env.OPENAI_API_KEY = envSecret;

    const result = await applyFresh('anthropic');
    const text = readConfig();

    for (const line of FIXTURE.split('\n').filter(Boolean)) {
      expect(text.split('\n'), line).toContain(line);
    }
    expect(text.startsWith('# Overdeck config: hand-edited, keep this comment\n')).toBe(true);
    expect(text).toContain('  openai: $OPENAI_API_KEY\n');
    expect(text).toContain('    batch_window_seconds: 7\n');
    expect(text).toContain('    knowledge_index: true\n');
    expect(text).not.toContain('project-only-model');
    expect(text).not.toContain(envSecret);

    const parsed = parse(text);
    expect(parsed.custom_block).toEqual({ a: 1 });
    expect(parsed.workhorses).toEqual({ expensive: 'claude-opus-5-5', mid: 'claude-opus-5-5', cheap: 'claude-haiku-4-5' });
    expect(parsed.roles.work).toEqual({ harness: 'claude-code', model: 'workhorse:mid', effort: 'high' });
    expect(parsed.tts.summarizer.model).toBe('gpt-5.4-mini');
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied.every((row) => row.status === 'change')).toBe(true);

    const state = await readPresetState();
    expect(state.lastApplied).toMatchObject({ presetId: 'anthropic', version: 1 });
    expect(state.undo?.changes.map((change) => change.path)).toEqual(result.applied.map((row) => row.path));

    // A second plan against the written file has nothing left to change.
    const again = await planPresetApply('anthropic', deps());
    expect(again.rows.filter((row) => row.status === 'change')).toEqual([]);
  });

  it('keeps the file\'s flow-collection style on untouched lines', async () => {
    const original = `${FIXTURE}custom_list: [a, b]\nnested:\n  pairs: {x: 1}\n`;
    writeFileSync(configPath, original);
    await applyFresh('anthropic');
    const text = readConfig();
    expect(text).toContain('custom_list: [a, b]\n');
    expect(text).toContain('  pairs: {x: 1}\n');
    await undoLastPresetApply(deps());
    expect(readConfig()).toBe(original);
  });

  it('undo restores the previous values exactly', async () => {
    const original = `${FIXTURE}models:\n  providers:\n    openai: false\n`;
    writeFileSync(configPath, original);

    await applyFresh('openai');
    expect(parse(readConfig()).models.providers.openai).toEqual({ enabled: true, harness: 'codex' });

    const undo = await undoLastPresetApply(deps());
    expect(undo.leftAsIs).toEqual([]);
    expect(undo.restored).toContain('models.providers.openai');
    const restored = parseDocument(readConfig()).toJS();
    expect(restored).toEqual(parseDocument(original).toJS());
    expect(restored.models.providers.openai).toBe(false);
    expect(await readPresetState()).toEqual({});
  });

  it('undo on an empty config removes the maps the apply created', async () => {
    await applyFresh('anthropic');
    await undoLastPresetApply(deps());
    expect(parseDocument(readConfig()).toJS() ?? {}).toEqual({});
  });

  it('undo leaves paths changed after apply alone', async () => {
    writeFileSync(configPath, FIXTURE);
    await applyFresh('anthropic');

    const doc = parseDocument(readConfig());
    doc.setIn(['roles', 'work', 'model'], 'claude-sonnet-5-5');
    writeFileSync(configPath, doc.toString());

    const undo = await undoLastPresetApply(deps());
    expect(undo.leftAsIs).toEqual([{ path: 'roles.work.model', reason: 'changed since apply; left as is' }]);
    expect(undo.restored).toContain('workhorses.mid');
    const parsed = parse(readConfig());
    expect(parsed.roles.work.model).toBe('claude-sonnet-5-5');
    expect(parsed.workhorses).toBeUndefined();
  });

  it('refuses a stale digest and leaves the file unchanged', async () => {
    writeFileSync(configPath, FIXTURE);
    await expect(applyPreset('anthropic', { expectedDigest: 'stale' }, deps())).rejects.toBeInstanceOf(PresetPlanStaleError);
    expect(readConfig()).toBe(FIXTURE);
    expect(await readPresetState()).toEqual({});
  });

  it('refuses a blocked plan and leaves the file unchanged', async () => {
    writeFileSync(configPath, FIXTURE);
    const blockedDeps = deps(null);
    const plan = await planPresetApply('anthropic', blockedDeps);
    expect(plan.blocked).toBeDefined();
    await expect(applyPreset('anthropic', { expectedDigest: plan.digest }, blockedDeps)).rejects.toBeInstanceOf(PresetBlockedError);
    expect(readConfig()).toBe(FIXTURE);
  });

  it('aborts when config.yaml changes mid-apply', async () => {
    writeFileSync(configPath, FIXTURE);
    const plan = await planPresetApply('anthropic', deps());
    let reads = 0;
    let writes = 0;
    const racing: PresetApplyDeps = {
      ...deps(),
      readConfigText: async () => (reads++ === 0 ? FIXTURE : `${FIXTURE}# edited elsewhere\n`),
      writeConfigText: async () => {
        writes++;
      },
    };
    await expect(applyPreset('anthropic', { expectedDigest: plan.digest }, racing)).rejects.toBeInstanceOf(ConfigChangedError);
    expect(writes).toBe(0);
    expect(readConfig()).toBe(FIXTURE);
    expect(await readPresetState()).toEqual({});
  });

  it('aborts on validation failure', async () => {
    const broken = `${FIXTURE.replace('roles:\n', 'roles:\n  flywheel:\n    minAgents: 5\n    maxAgents: 2\n')}`;
    writeFileSync(configPath, broken);
    await expect(applyFresh('anthropic')).rejects.toBeInstanceOf(PresetValidationError);
    expect(readConfig()).toBe(broken);
  });

  it('undo without a record throws NoPresetUndoError', async () => {
    await expect(undoLastPresetApply(deps())).rejects.toBeInstanceOf(NoPresetUndoError);
  });
});

describe('listPresetStatus', () => {
  it('reports updateAvailable when lastApplied.version < preset.version', async () => {
    writeFileSync(presetStatePath(), JSON.stringify({ lastApplied: { presetId: 'anthropic', version: 0, appliedAt: '2026-09-01T00:00:00.000Z' } }));
    const status = await listPresetStatus();
    const byId = Object.fromEntries(status.presets.map((preset) => [preset.id, preset]));
    expect(byId.anthropic!.updateAvailable).toBe(true);
    expect(byId.anthropic!.lastApplied?.version).toBe(0);
    expect(byId['anthropic-cost-saver']!.updateAvailable).toBe(false);
    expect(byId.openai!.updateAvailable).toBe(false);
    expect(status.undoAvailable).toBe(false);
  });

  it('reports undoAvailable after an apply', async () => {
    await applyFresh('anthropic');
    const status = await listPresetStatus();
    expect(status.undoAvailable).toBe(true);
    expect(status.presets.find((preset) => preset.id === 'anthropic')!.updateAvailable).toBe(false);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getHarnessBehavior, KNOWN_HARNESSES } from '@overdeck/contracts';
import { getProviderForModelSync } from '../providers.js';
import { parseMuseSessionMetadata } from '../conversations/harness-metadata.js';
import { applyFallbackSync } from '../model-fallback.js';
import { getPricingSync } from '../cost.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getAvailableModelsApi } from '../settings-api.js';
import { mergeConfigs } from '../config-yaml/merge.js';
import { parseMuseRecords, summarizeMuseRecords } from '../cost-parsers/muse-parser.js';
import { museDataHome, resolveMuseSessionPath } from '../runtimes/muse-session.js';
import { renderForHarness } from '../context-layers/harness.js';
import { parseMuseConversationMessages } from '../../dashboard/server/services/muse-conversation-parser.js';

const models = ['muse-spark-1.3', 'muse-spark-1.3-contributor'] as const;
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('Muse model and harness support', () => {
  it('registers both tiers without changing their exact identity', () => {
    expect(KNOWN_HARNESSES.has('muse')).toBe(true);
    expect(getHarnessBehavior('muse').executableName).toBe('muse');
    expect(getAvailableModelsApi().meta.map(model => model.id)).toEqual(models);
    for (const model of models) {
      expect(getProviderForModelSync(model)).toMatchObject({ name: 'meta', defaultHarness: 'muse' });
      expect(canUseHarnessSync('muse', model, undefined).allowed).toBe(true);
      expect(canUseHarnessSync('claude-code', model, undefined).allowed).toBe(false);
    }
    expect(canUseHarnessSync('muse', 'claude-sonnet-5', undefined).allowed).toBe(false);
    expect(applyFallbackSync(models[0], new Set(['meta']))).toBe(models[0]);
    expect(() => applyFallbackSync(models[0], new Set(['anthropic']))).toThrow('Meta (Muse) is disabled');
    expect(getAvailableModelsApi().meta[1].name).toContain('training data');
  });

  it('preserves opt-in provider settings and Muse-specific context', () => {
    const { config } = mergeConfigs({ models: { providers: { meta: { enabled: true, harness: 'muse' } } } });
    expect(config.enabledProviders.has('meta')).toBe(true);
    expect(config.providerHarnesses.meta).toBe('muse');
    expect(renderForHarness('shared {{#harness:muse}}native{{/harness:muse}}{{#harness:claude}}claude{{/harness:claude}}', 'muse')).toBe('shared native');
  });

  it.each(models)('launches %s interactively and resumes only a native UUID', model => {
    const script = generateLauncherScriptSync({ role: 'work', workingDir: '/tmp/muse workspace', harness: 'muse',
      museModel: model, overdeckEnv: { agentId: 'conv-muse-test' },
      resumeSessionId: 'stale-claude-id', museResumeSessionId: 'native-muse-id',
      museContextFile: '/tmp/context with spaces.md', spawnMode: 'conversation' });
    expect(script).toContain(`muse --model '${model}' --reasoning-effort 'high'`);
    expect(script).toContain("resume 'native-muse-id'");
    expect(script).toContain('XDG_DATA_HOME=');
    expect(script).toContain("TBH_EVAL_APPEND_DEVELOPER_PROMPT_FILE='/tmp/context with spaces.md'");
    expect(script).not.toContain('stale-claude-id');
    expect(script).not.toContain('muse exec');
    expect(script).not.toContain('--yolo');
  });

  it('requires an explicit model instead of using Muse settings as a fallback', () => {
    expect(() => generateLauncherScriptSync({ role: 'work', workingDir: '/tmp', harness: 'muse',
      overdeckEnv: { agentId: 'agent-muse-test' } })).toThrow('explicit supported Muse');
  });

  it('selects only the newest root session in the requested agent directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-sessions-')); temporary.push(root);
    const dir = join(museDataHome('conv-one', root), 'muse', 'sessions', '2026', '09', '08');
    for (const path of [join(dir, '01-older', 'session.jsonl'), join(dir, '02-newer', 'session.jsonl'),
      join(dir, '02-newer', 'subagent', '99-child', 'session.jsonl')]) {
      await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, '{}\n');
    }
    expect(await resolveMuseSessionPath('conv-one', root)).toBe(join(dir, '02-newer', 'session.jsonl'));
    expect(await resolveMuseSessionPath('conv-two', root)).toBeNull();
    expect(() => museDataHome('../escape', root)).toThrow('identity');
  });

  it.each(models)('prices %s with cached input counted once', model => {
    const metadata = { id: 'metadata', payload_type: 'runtime.session.metadata', payload: { record: { model_id: model } } };
    const completion = { id: 'completion', payload_type: 'runtime.session', payload: { kind: 'run', event: {
      kind: 'model_completed', usage: { input_tokens: 1000000, output_tokens: 1000000, cached_tokens: 500000 },
    } } };
    const records = parseMuseRecords([metadata, completion, completion].map(record => JSON.stringify(record)).join('\n') + '\n{"partial":');
    const result = summarizeMuseRecords(records, '/sessions/root/session.jsonl');
    const price = getPricingSync('custom', model)!;
    expect(result?.usage).toEqual({ inputTokens: 500000, outputTokens: 1000000, cacheReadTokens: 500000 });
    expect(result?.cost).toBeCloseTo(500 * price.inputPer1k + 1000 * price.outputPer1k + 500 * price.cacheReadPer1k!);
    expect(result?.cost).toBeCloseTo(model.endsWith('contributor') ? 0.251 : 4.95);
  });

  it('reads real Muse 1.0.2 echo turns without rendering private reasoning or duplicating user intents', async () => {
    const result = await parseMuseConversationMessages(resolve('tests/fixtures/muse/echo-session.jsonl'));
    expect(result.messages.map(message => message.text)).toEqual([
      'Muse integration echo fixture', 'echo: Muse integration echo fixture',
      'Second isolated message', 'echo: Second isolated message',
    ]);
    const metadata = await parseMuseSessionMetadata(resolve('tests/fixtures/muse/echo-session.jsonl'));
    expect(metadata.messageCount).toBe(4);
    expect(metadata.cwdFromFirstMessage).toBeTruthy();
    expect(result.streaming).toBe(false);
    expect(result.lastTurnCompletedAt).toBeTruthy();
  });
});

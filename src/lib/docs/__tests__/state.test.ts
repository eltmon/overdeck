import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../config-yaml.js';
import type { DocsPathOverrides } from '../../paths.js';
import {
  docsBudgetKey,
  evaluateDocsPromptGate,
  getDocsDisableStatus,
  matchDocsTrigger,
  readDocsBudgetState,
  readDocsDisableState,
  recordDocsInjection,
  recordDocsTelemetry,
  setDocsDisabled,
} from '../state.js';

let rootDir: string;
let paths: DocsPathOverrides;

function gateConfig(overrides: {
  enabled?: boolean;
  promptInjectionEnabled?: boolean;
  trigger?: Partial<NormalizedDocsConfig['trigger']>;
  budget?: Partial<NormalizedDocsConfig['budget']>;
} = {}): Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'> {
  const defaults = getDefaultDocsConfig();
  return {
    enabled: overrides.enabled ?? defaults.enabled,
    promptInjectionEnabled: overrides.promptInjectionEnabled ?? defaults.promptInjectionEnabled,
    trigger: { ...defaults.trigger, ...overrides.trigger },
    budget: { ...defaults.budget, ...overrides.budget },
  };
}

describe('docs prompt state', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-state-'));
    paths = {
      budgetStatePath: join(rootDir, 'docs', 'budget-state.json'),
      disableStatePath: join(rootDir, 'docs', 'disable-state.json'),
      telemetryPath: join(rootDir, 'docs', 'telemetry.jsonl'),
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('matches configured trigger patterns and ignores invalid regexes', () => {
    expect(matchDocsTrigger('How does Overdeck sync docs?', gateConfig().trigger)).toContain('panopticon');
    expect(matchDocsTrigger('tell me about docs', { regexes: ['[', 'docs'], caseSensitive: false })).toEqual(['docs']);
    expect(matchDocsTrigger('PANOPTICON', { regexes: ['panopticon'], caseSensitive: true })).toEqual([]);
  });

  it('allows injection for a matching prompt with a session id and records the session budget', async () => {
    const result = await evaluateDocsPromptGate({
      payload: { prompt: 'How does pan start work?', sessionId: ' session-1 ', projectPath: '/project' },
      config: gateConfig(),
      paths,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(result).toMatchObject({ shouldInject: true, budgetKey: 'session:session-1' });
    expect(result.matched).toContain('pan');

    await recordDocsInjection({
      budgetKey: result.budgetKey,
      tokens: 123,
      paths,
      now: new Date('2026-05-24T10:00:01.000Z'),
    });

    const state = await readDocsBudgetState(paths);
    expect(state.records['session:session-1']).toEqual({
      turn: 1,
      injections: [{ turn: 1, ts: '2026-05-24T10:00:01.000Z', tokens: 123 }],
    });
  });

  it('falls back predictably when hook payloads omit session and project ids', async () => {
    const result = await evaluateDocsPromptGate({
      payload: { prompt: 'workspace documentation question' },
      config: gateConfig(),
      paths,
    });

    expect(result.shouldInject).toBe(true);
    expect(result.budgetKey).toBe('anonymous');
    expect(docsBudgetKey({})).toBe('anonymous');

    await setDocsDisabled({ scope: 'session', disabled: true, paths, now: new Date('2026-05-24T11:00:00.000Z') });
    const status = await getDocsDisableStatus({}, paths);

    expect(status).toMatchObject({ disabled: true, scope: 'session' });
    const disableState = await readDocsDisableState(paths);
    expect(disableState.sessions['missing-session']).toMatchObject({ disabled: true });
  });

  it('uses session over project over global scope precedence for disable and enable entries', async () => {
    await setDocsDisabled({ scope: 'global', disabled: true, paths });
    await setDocsDisabled({ scope: 'project', projectPath: '/repo', disabled: false, paths });
    await setDocsDisabled({ scope: 'session', sessionId: 'abc', disabled: true, paths });

    await expect(getDocsDisableStatus({ sessionId: 'abc', projectPath: '/repo' }, paths)).resolves.toMatchObject({
      disabled: true,
      scope: 'session',
    });
    await expect(getDocsDisableStatus({ sessionId: 'other', projectPath: '/repo' }, paths)).resolves.toMatchObject({
      disabled: false,
      scope: 'project',
    });
    await expect(getDocsDisableStatus({ sessionId: 'other', projectPath: '/other' }, paths)).resolves.toMatchObject({
      disabled: true,
      scope: 'global',
    });
  });

  it('gates disabled, untriggered, and over-budget prompts with explicit reasons', async () => {
    await expect(evaluateDocsPromptGate({
      payload: { prompt: 'pan docs', sessionId: 'disabled' },
      config: gateConfig({ enabled: false }),
      paths,
    })).resolves.toMatchObject({ shouldInject: false, reason: 'docs_disabled' });

    await expect(evaluateDocsPromptGate({
      payload: { prompt: 'ordinary prompt', sessionId: 'plain' },
      config: gateConfig({ trigger: { regexes: ['pan'] } }),
      paths,
    })).resolves.toMatchObject({ shouldInject: false, reason: 'no_trigger' });

    const config = gateConfig({ budget: { injectionRate: 1, turnWindow: 10 } });
    const first = await evaluateDocsPromptGate({ payload: { prompt: 'pan docs', sessionId: 'budgeted' }, config, paths });
    expect(first.shouldInject).toBe(true);
    await recordDocsInjection({ budgetKey: first.budgetKey, tokens: 100, paths });

    await expect(evaluateDocsPromptGate({
      payload: { prompt: 'pan docs again', sessionId: 'budgeted' },
      config,
      paths,
    })).resolves.toMatchObject({ shouldInject: false, reason: 'budget_exhausted' });
  });

  it('fails open when prompt-time state files are unreadable', async () => {
    await mkdir(join(rootDir, 'docs'), { recursive: true });
    await writeFile(paths.budgetStatePath!, '{not-json', 'utf8');

    await expect(evaluateDocsPromptGate({
      payload: { prompt: 'pan docs', sessionId: 'broken' },
      config: gateConfig(),
      paths,
    })).resolves.toMatchObject({ shouldInject: false, budgetKey: 'session:broken', reason: 'state_error' });
    await expect(recordDocsInjection({ budgetKey: 'session:broken', tokens: 10, paths })).resolves.toBeUndefined();
  });

  it('records prompt-safe telemetry without storing full prompts', async () => {
    await mkdir(join(rootDir, 'docs'), { recursive: true });

    await recordDocsTelemetry({
      queryCount: 2,
      injectedTokens: 50,
      hit: true,
      reason: 'budget_exhausted',
      matched: ['pan'],
      budgetKey: 'session:abc',
      chunkCount: 3,
      paths,
      now: new Date('2026-05-24T12:00:00.000Z'),
    });

    const telemetry = await readFile(paths.telemetryPath!, 'utf8');
    const entry = JSON.parse(telemetry.trim()) as Record<string, unknown>;

    expect(entry).toMatchObject({
      ts: '2026-05-24T12:00:00.000Z',
      event: 'injection',
      queryCount: 2,
      injectedTokens: 50,
      hit: true,
      reason: 'budget_exhausted',
      matched: ['pan'],
      budgetKey: 'session:abc',
      chunkCount: 3,
    });
    expect(entry).not.toHaveProperty('prompt');
    expect(telemetry).not.toContain('secret prompt text');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAvailableModelsApi } from '../settings-model-catalog.js';
import { getAvailableModelsApi as compatibilityExport } from '../settings-api.js';

// Captured by executing the catalog functions from 7346a85bec0 before extraction.
const previousCatalog = JSON.parse(readFileSync(new URL('./fixtures/pre-opencode-model-catalog.json', import.meta.url), 'utf8'));
const opus55 = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5 (1M context)',
  contextWindow: 1000000,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  costPer1MTokens: 12,
};
const sonnet55 = {
  id: 'claude-sonnet-5-5',
  name: 'Claude Sonnet 5.5 (1M context)',
  contextWindow: 1000000,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  costPer1MTokens: 6,
};
const haiku55 = {
  id: 'claude-haiku-5-5',
  name: 'Claude Haiku 5.5 (1M context)',
  contextWindow: 1000000,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  costPer1MTokens: 0.3,
};

// GPT-6 Sol/Luna (2026-09-22), GPT-6.1 Sol (2026-09-29), GPT-6.1 Terra (2026-10-26), and
// GPT-6 Rosalind / GPT-6 Astra for Law (2026-11-02) are additions after the fixture was captured.
const gpt6Additions = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 6 },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 3 },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 6 },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 0.3 },
  { id: 'gpt-6-astra-law', name: 'GPT-6 Astra for Law (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 30 },
  { id: 'gpt-6-rosalind', name: 'GPT-6 Rosalind (272K context)', contextWindow: 272000, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], costPer1MTokens: 45 },
];
const gpt6AdditionIds = new Set(gpt6Additions.map((model) => model.id));
// Muse Wonder (2026-10-12) is an addition after the fixture was captured.
const museWonderId = 'muse-wonder-1.0';
// Gemini 4 Argon (GA 2026-10-13) is an addition after the fixture was captured.
const geminiArgon = {
  id: 'gemini-4-argon',
  name: 'Gemini 4 Argon (1M context)',
  contextWindow: 1048576,
  effortLevels: ['low', 'medium', 'high'],
  costPer1MTokens: 6,
};
// Kimi K3.1 Pro / K3.1 Pro Highspeed (2026-10-23) are additions after the fixture was captured.
const kimiK31AdditionIds = new Set(['k3.1-pro', 'k3.1-pro-highspeed', 'kimi-code/k3.1-pro', 'kimi-code/k3.1-pro-highspeed']);
// MiMo V2.5 Pro / V2.5 were retired 2026-10-21; the V2.6 series replaces them (PAN-4825).
const mimoV26Ids = ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'];
// MiniMax M3.1 Flash is an addition after the fixture was captured (PAN-4825).
const minimaxM31FlashId = 'MiniMax-M3.1-Flash';
// Gemini 3.6 Flash and the GA id for 3.1 Flash Lite are additions after the fixture was captured (PAN-4827).
const gemini36FlashId = 'gemini-3.6-flash';
const gemini31FlashLiteId = 'gemini-3.1-flash-lite';
// GLM-5.3 Flash / FlashX are additions after the fixture was captured (PAN-4827).
const glm53FlashIds = ['glm-5.3-flash', 'glm-5.3-flashx'];
// Meta's reasoning docs list max for muse-spark-1.3 but not for -contributor (PAN-4825).
const expectedPreviousCatalog = {
  ...previousCatalog,
  mimo: [],
  meta: previousCatalog.meta.map((model: { id: string }) => (model.id === 'muse-spark-1.3' ? { ...model, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] } : model)),
  // The Kimi CLI now serves kimi-for-coding as K2.8 Preview (1M, low/high/max) and names the highspeed alias K2.7 Code Highspeed (PAN-4825).
  kimi: previousCatalog.kimi.map((model: { id: string }) => {
    if (model.id === 'kimi-code/kimi-for-coding') {
      return { ...model, name: 'Kimi K2.8 Preview (1M context) — Kimi Code CLI', baseName: 'Kimi K2.8 Preview (1M context)', contextWindow: 1048576, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] };
    }
    if (model.id === 'kimi-code/kimi-for-coding-highspeed') {
      return { ...model, name: 'Kimi K2.7 Code Highspeed (256K context) — Kimi Code CLI', baseName: 'Kimi K2.7 Code Highspeed (256K context)' };
    }
    return model;
  }),
  // gemini-3.1-flash-lite-preview retired to the GA id; gemini-3.8-flash and gemini-3-flash-preview
  // move off their launch-era placeholder rates to the official prices (PAN-4827).
  google: previousCatalog.google
    .filter((model: { id: string }) => model.id !== 'gemini-3.1-flash-lite-preview')
    .map((model: { id: string; costPer1MTokens: number }) => {
      if (model.id === 'gemini-3.8-flash') return { ...model, costPer1MTokens: 2.25 };
      if (model.id === 'gemini-3-flash-preview') return { ...model, costPer1MTokens: 1.75 };
      return model;
    }),
  // qwen3-max, qwen3-coder-plus and qwen3-plus retired 2026-10-10 (dead or never-real DashScope ids);
  // qwen3.7-max, qwen3.8-flash and qwen3.8-max move off their $0 placeholders, and qwen3.8-max's
  // context window corrects from 1,048,576 to the documented 1,000,000 (PAN-4827).
  dashscope: previousCatalog.dashscope
    .filter((model: { id: string }) => !['qwen3-max', 'qwen3-coder-plus', 'qwen3-plus'].includes(model.id))
    .map((model: { id: string; costPer1MTokens: number; contextWindow: number }) => {
      if (model.id === 'qwen3.7-max') return { ...model, costPer1MTokens: 5 };
      if (model.id === 'qwen3.8-flash') return { ...model, costPer1MTokens: 0.31 };
      if (model.id === 'qwen3.8-max') return { ...model, costPer1MTokens: 4, contextWindow: 1000000 };
      return model;
    }),
};

function withoutOpus55<T extends { anthropic: Array<{ id: string }>; openai: Array<{ id: string }>; google: Array<{ id: string }>; meta: Array<{ id: string }>; kimi: Array<{ id: string }>; mimo: Array<{ id: string }>; minimax: Array<{ id: string }>; zai: Array<{ id: string }> }>(catalog: T): T {
  return {
    ...catalog,
    anthropic: catalog.anthropic.filter((model) => ![opus55.id, sonnet55.id, haiku55.id].includes(model.id)),
    openai: catalog.openai.filter((model) => !gpt6AdditionIds.has(model.id)),
    google: catalog.google.filter((model) => ![geminiArgon.id, gemini36FlashId, gemini31FlashLiteId].includes(model.id)),
    meta: catalog.meta.filter((model) => model.id !== museWonderId),
    kimi: catalog.kimi.filter((model) => !kimiK31AdditionIds.has(model.id)),
    mimo: catalog.mimo.filter((model) => !mimoV26Ids.includes(model.id)),
    minimax: catalog.minimax.filter((model) => model.id !== minimaxM31FlashId),
    zai: catalog.zai.filter((model) => !glm53FlashIds.includes(model.id)),
  };
}

describe('model catalog no-loss audit', () => {
  it('preserves every previous provider, ordered model, display name, price and effort field', () => {
    const { opencode, 'opencode-go': go, ...existing } = getAvailableModelsApi();
    expect(existing.anthropic.find((model) => model.id === opus55.id)).toEqual(opus55);
    expect(existing.anthropic.find((model) => model.id === sonnet55.id)).toEqual(sonnet55);
    expect(existing.anthropic.findIndex((model) => model.id === sonnet55.id)).toBeLessThan(existing.anthropic.findIndex((model) => model.id === 'claude-sonnet-5'));
    expect(existing.anthropic.find((model) => model.id === haiku55.id)).toEqual(haiku55);
    expect(existing.anthropic.findIndex((model) => model.id === haiku55.id)).toBeLessThan(existing.anthropic.findIndex((model) => model.id === 'claude-haiku-4-5'));
    expect(existing.openai.slice(0, 5).map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna']);
    expect(existing.openai.filter((model) => gpt6AdditionIds.has(model.id))).toEqual(gpt6Additions);
    expect(existing.google[0]).toEqual(geminiArgon);
    expect(withoutOpus55(existing)).toEqual(expectedPreviousCatalog);
    expect(opencode).toEqual([]);
    expect(go).toEqual([]);
    expect(compatibilityExport).toBe(getAvailableModelsApi);
  });

  it('registers K3.1 Pro and K3.1 Pro Highspeed under the Claude Code and Kimi Code CLI harnesses', () => {
    const { kimi } = getAvailableModelsApi();
    const k31Pro = kimi.find((model) => model.id === 'k3.1-pro');
    const k31ProHighspeed = kimi.find((model) => model.id === 'k3.1-pro-highspeed');
    const k31ProNative = kimi.find((model) => model.id === 'kimi-code/k3.1-pro');
    const k31ProHighspeedNative = kimi.find((model) => model.id === 'kimi-code/k3.1-pro-highspeed');
    expect(k31Pro?.harness).toBe('claude-code');
    expect(k31Pro?.baseName).toBe('Kimi K3.1 Pro (1M context)');
    expect(k31ProHighspeed?.harness).toBe('claude-code');
    expect(k31ProNative?.harness).toBe('kimi-code');
    expect(k31ProHighspeedNative?.harness).toBe('kimi-code');
  });

  it('lists MiniMax M3.1 Flash with its 1M context label', () => {
    expect(getAvailableModelsApi().minimax.find((model) => model.id === minimaxM31FlashId)?.name).toBe('MiniMax M3.1 Flash (1M context)');
  });

  it('lists exactly the MiMo V2.6 series and no retired V2.5 id', () => {
    expect(getAvailableModelsApi().mimo.map((model) => model.id)).toEqual(mimoV26Ids);
  });

  it('adds native Go and Zen rows without changing the previous catalog', () => {
    const zen = { id: 'opencode/kimi-k3' as const, name: 'Kimi K3', costPer1MTokens: 3, harness: 'opencode' as const };
    const go = { ...zen, id: 'opencode-go/kimi-k3' as const };
    const { opencode, 'opencode-go': goModels, ...existing } = getAvailableModelsApi([zen, go]);
    expect(opencode).toEqual([zen]);
    expect(goModels).toEqual([go]);
    expect(existing.anthropic.find((model) => model.id === opus55.id)).toEqual(opus55);
    expect(existing.anthropic.find((model) => model.id === sonnet55.id)).toEqual(sonnet55);
    expect(existing.anthropic.find((model) => model.id === haiku55.id)).toEqual(haiku55);
    expect(withoutOpus55(existing)).toEqual(expectedPreviousCatalog);
  });
});

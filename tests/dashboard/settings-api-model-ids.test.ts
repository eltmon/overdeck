import { describe, expect, it } from 'vitest';

import { MODEL_API_IDS } from '../../src/dashboard/server/routes/settings.js';

describe('settings API test model IDs', () => {
  it('maps DashScope model IDs to the selected model', () => {
    expect(MODEL_API_IDS['qwen3-max']?.apiModel).toBe('qwen3.7-max');
    expect(MODEL_API_IDS['qwen3-coder-plus']?.apiModel).toBe('qwen3.7-plus');
    expect(MODEL_API_IDS['qwen3-plus']?.apiModel).toBe('qwen3.8-flash');
    expect(MODEL_API_IDS['qwen3.7-max']?.apiModel).toBe('qwen3.7-max');
    expect(MODEL_API_IDS['qwen3.8-max']?.apiModel).toBe('qwen3.8-max');
  });

  it('maps Google model IDs to live apiModel targets', () => {
    expect(MODEL_API_IDS['gemini-3-pro-preview']?.apiModel).toBe('gemini-3.1-pro-preview');
    expect(MODEL_API_IDS['gemini-3-flash-preview']?.apiModel).toBe('gemini-3-flash-preview');
    expect(MODEL_API_IDS['gemini-2.5-pro']?.apiModel).toBe('gemini-3.1-pro-preview');
    expect(MODEL_API_IDS['gemini-2.5-flash']?.apiModel).toBe('gemini-3-flash-preview');
  });

  it('never maps to a retired gemini-1.5 id or a dead Qwen id', () => {
    for (const { apiModel } of Object.values(MODEL_API_IDS)) {
      expect(apiModel.startsWith('gemini-1.5')).toBe(false);
      expect(apiModel).not.toBe('qwen3-max');
      expect(apiModel).not.toBe('qwen3-coder-plus');
      expect(apiModel).not.toBe('qwen3-plus');
    }
  });
});

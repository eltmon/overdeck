import { describe, expect, it } from 'vitest';

import { MODEL_API_IDS } from '../../src/dashboard/server/routes/settings.js';

describe('settings API test model IDs', () => {
  it('maps DashScope model IDs to the selected model', () => {
    expect(MODEL_API_IDS['qwen3-max']?.apiModel).toBe('qwen3-max');
    expect(MODEL_API_IDS['qwen3-coder-plus']?.apiModel).toBe('qwen3-coder-plus');
    expect(MODEL_API_IDS['qwen3-plus']?.apiModel).toBe('qwen3-plus');
    expect(MODEL_API_IDS['qwen3.7-max']?.apiModel).toBe('qwen3.7-max');
  });
});

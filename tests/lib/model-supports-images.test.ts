import { describe, it, expect } from 'vitest';
import { modelSupportsImages, MODEL_CAPABILITIES } from '../../src/lib/model-capabilities.js';

// PAN-1685: image-attach guard for text-only models. mimo-v2.5-pro was proven
// text-only on the Xiaomi Token-Plan endpoint (404 "No endpoints found that
// support image input"); mimo-v2.5 accepted images on the same endpoint. Both
// were retired 2026-10-21 (PAN-4825); their capability rows stay as history.
describe('modelSupportsImages', () => {
  it('returns false for a proven text-only model (glm-5.3)', () => {
    expect(MODEL_CAPABILITIES['mimo-v2.5-pro'].supportsImages).toBe(false);
    expect(modelSupportsImages('glm-5.3')).toBe(false);
  });

  it('resolves a retired id to its unaudited successor before checking (mimo-v2.5-pro → mimo-v2.6-pro)', () => {
    expect(modelSupportsImages('mimo-v2.5-pro')).toBe(true);
  });

  it('returns true for the multimodal sibling (mimo-v2.5)', () => {
    expect(MODEL_CAPABILITIES['mimo-v2.5'].supportsImages).toBe(true);
    expect(modelSupportsImages('mimo-v2.5')).toBe(true);
  });

  it('is permissive for unflagged models (undefined → allow)', () => {
    // Most models are deliberately unaudited; they must not be blocked.
    expect(MODEL_CAPABILITIES['claude-opus-4-8'].supportsImages).toBeUndefined();
    expect(modelSupportsImages('claude-opus-4-8')).toBe(true);
  });

  it('is permissive for entirely unknown model ids', () => {
    expect(modelSupportsImages('some-model-we-have-never-heard-of')).toBe(true);
  });
});

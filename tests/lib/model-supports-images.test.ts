import { describe, it, expect } from 'vitest';
import { modelSupportsImagesSync, MODEL_CAPABILITIES } from '../../src/lib/model-capabilities.js';

// PAN-1685: image-attach guard for text-only models. mimo-v2.5-pro is proven
// text-only on the Xiaomi Token-Plan endpoint (404 "No endpoints found that
// support image input"); mimo-v2.5 accepts images on the same endpoint.
describe('modelSupportsImagesSync', () => {
  it('returns false for the proven text-only model (mimo-v2.5-pro)', () => {
    expect(MODEL_CAPABILITIES['mimo-v2.5-pro'].supportsImages).toBe(false);
    expect(modelSupportsImagesSync('mimo-v2.5-pro')).toBe(false);
  });

  it('returns true for the multimodal sibling (mimo-v2.5)', () => {
    expect(MODEL_CAPABILITIES['mimo-v2.5'].supportsImages).toBe(true);
    expect(modelSupportsImagesSync('mimo-v2.5')).toBe(true);
  });

  it('is permissive for unflagged models (undefined → allow)', () => {
    // Most models are deliberately unaudited; they must not be blocked.
    expect(MODEL_CAPABILITIES['claude-opus-4-8'].supportsImages).toBeUndefined();
    expect(modelSupportsImagesSync('claude-opus-4-8')).toBe(true);
  });

  it('is permissive for entirely unknown model ids', () => {
    expect(modelSupportsImagesSync('some-model-we-have-never-heard-of')).toBe(true);
  });
});

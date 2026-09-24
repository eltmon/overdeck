import { describe, expect, it } from 'vitest';
import { selectModel } from '../../src/lib/smart-model-selector.js';

describe('selectModel', () => {
  it('fails loudly when no models are available instead of returning a literal model', () => {
    expect(() => selectModel('role-plan', [])).toThrow(/No models available to select for role-plan/);
  });

  it('selects only from the available models', () => {
    expect(selectModel('role-plan', ['claude-haiku-4-5']).model).toBe('claude-haiku-4-5');
  });
});

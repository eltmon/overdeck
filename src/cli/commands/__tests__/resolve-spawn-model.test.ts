import { describe, it, expect } from 'vitest';
import { resolveSpawnModel } from '../start.js';

// PAN-2410: --fresh must re-run staffing against current config instead of
// inheriting the dead agent's recorded model.
describe('resolveSpawnModel (PAN-2410)', () => {
  it('--fresh without --model ignores the recorded model so tier staffing runs', () => {
    expect(resolveSpawnModel(undefined, true, 'claude-haiku-4-5')).toBeUndefined();
  });

  it('plain restart keeps the recorded model (resume-keeps-staffing contract)', () => {
    expect(resolveSpawnModel(undefined, false, 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(resolveSpawnModel(undefined, undefined, 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('explicit --model always wins, fresh or not', () => {
    expect(resolveSpawnModel('kimi-k2.7-code', true, 'claude-haiku-4-5')).toBe('kimi-k2.7-code');
    expect(resolveSpawnModel('kimi-k2.7-code', false, 'claude-haiku-4-5')).toBe('kimi-k2.7-code');
  });

  it('a pending- placeholder recorded model is treated as no recorded model', () => {
    // Mid-spawn placeholder left by a spawn that died before model resolution
    // (e.g. dashboard restart killing the post-finalize auto-spawn). Inheriting
    // it crashed spawn with "Unknown model"; staffing must re-run instead.
    expect(resolveSpawnModel(undefined, undefined, 'pending-work-spawn')).toBeUndefined();
    expect(resolveSpawnModel(undefined, false, 'pending-work-spawn')).toBeUndefined();
  });
});

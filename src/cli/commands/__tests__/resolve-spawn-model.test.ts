import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

// PAN-3857 (D2/D3): pan start must compose its spawn model from the explicit
// --model flag and the prior agent's model (resume continuity) ONLY. Reading
// record.workModel back into the spawn model made every stamped default count
// as an explicit override, which skipped tier resolution and re-stamped the
// record on every start. The issue-override tier in resolveStaffing is the
// one place a stored record.workModel takes effect.
describe('pan start spawn-model composition (PAN-3857)', () => {
  const source = readFileSync(new URL('../start.ts', import.meta.url), 'utf-8');

  it('never reads record.workModel back into the spawn model', () => {
    expect(source).not.toContain('resolveIssueWorkModel');
  });

  it('resume path: prior agent on model M and no --model resumes with M', () => {
    // The composition at the call site is `options.model ?? resolveSpawnModel(undefined, ...)`,
    // so with no explicit flag the recorded model flows through unchanged.
    expect(source).toContain('options.model ?? resolveSpawnModel(undefined, options.fresh, existingAgentState?.model)');
    expect(resolveSpawnModel(undefined, false, 'claude-opus-5')).toBe('claude-opus-5');
  });

  it('fresh spawn with no --model and a prior agent model runs tier resolution', () => {
    expect(resolveSpawnModel(undefined, true, 'claude-opus-5')).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePanStartSpawnModel, resolveSpawnModel, resolveStartSpawnModel } from '../start-spawn-model.js';
import { SESSION_RESET_MARKER } from '../../../lib/session-history.js';

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
  });
});

// PAN-3857 (D2/D3): the spawn model comes from the explicit --model flag and
// the prior agent's model (resume continuity) ONLY. record.workModel is never
// read back into it — a stored override takes effect through the
// issue-override tier in resolveStaffing instead.
describe('resolveStartSpawnModel (PAN-3857)', () => {
  it('resume path: a prior agent on model M and no --model resumes with M', () => {
    expect(resolveStartSpawnModel(undefined, false, 'claude-opus-5')).toBe('claude-opus-5');
    expect(resolveStartSpawnModel(undefined, undefined, 'claude-opus-5')).toBe('claude-opus-5');
  });

  it('fresh spawn with no --model ignores the prior agent model so tier resolution runs', () => {
    expect(resolveStartSpawnModel(undefined, true, 'claude-opus-5')).toBeUndefined();
  });

  it('no --model and no prior agent leaves the model to tier/role resolution', () => {
    expect(resolveStartSpawnModel(undefined, undefined, undefined)).toBeUndefined();
    expect(resolveStartSpawnModel(undefined, false, undefined)).toBeUndefined();
  });

  it('explicit --model wins over the prior agent model, fresh or not', () => {
    expect(resolveStartSpawnModel('gpt-5.6', true, 'claude-opus-5')).toBe('gpt-5.6');
    expect(resolveStartSpawnModel('gpt-5.6', false, 'claude-opus-5')).toBe('gpt-5.6');
  });

  it('a pending- placeholder prior model does not count as resume continuity', () => {
  });
});

// PAN-3855: `pan reset-session` discards the session, so the next plain
// `pan start` has no resume continuity to preserve and must not reuse the
// recorded model — a retuned tier would otherwise never apply without --fresh.
describe('resolveStartSpawnModel after a session reset (PAN-3855)', () => {
  it('a pending reset drops the recorded model so tier/role routing runs', () => {
    expect(resolveStartSpawnModel(undefined, false, 'claude-haiku-4-5', true)).toBeUndefined();
    expect(resolveStartSpawnModel(undefined, undefined, 'claude-haiku-4-5', true)).toBeUndefined();
  });

  it('an explicit --model still wins after a reset', () => {
    expect(resolveStartSpawnModel('claude-opus-5', false, 'claude-haiku-4-5', true)).toBe('claude-opus-5');
  });

  it('without a reset the recorded model is still inherited', () => {
    expect(resolveStartSpawnModel(undefined, false, 'claude-haiku-4-5', false)).toBe('claude-haiku-4-5');
  });
});

describe('resolvePanStartSpawnModel reads the session-reset marker (PAN-3855)', () => {
  const agentId = 'agent-pan-3855';
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.OVERDECK_HOME;
    home = mkdtempSync(join(tmpdir(), 'pan-3855-'));
    process.env.OVERDECK_HOME = home;
    mkdirSync(join(home, 'agents', agentId), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('after pan reset-session the recorded model is not reused and the operator is told', () => {
    writeFileSync(join(home, 'agents', agentId, SESSION_RESET_MARKER), '');
    expect(resolvePanStartSpawnModel(agentId, undefined, false, 'claude-haiku-4-5')).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not reusing recorded model claude-haiku-4-5'));
  });

  it('with no reset marker a plain start keeps the recorded model silently', () => {
    expect(resolvePanStartSpawnModel(agentId, undefined, false, 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('an explicit --model wins over a reset without a note', () => {
    writeFileSync(join(home, 'agents', agentId, SESSION_RESET_MARKER), '');
    expect(resolvePanStartSpawnModel(agentId, 'claude-opus-5', false, 'claude-haiku-4-5')).toBe('claude-opus-5');
    expect(console.log).not.toHaveBeenCalled();
  });
});

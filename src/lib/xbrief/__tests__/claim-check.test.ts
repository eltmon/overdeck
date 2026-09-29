import { describe, it, expect, vi } from 'vitest';
import {
  checkClaim,
  probeHolder,
  resolveClaimantId,
  holdersToProbe,
  formatClaimRefusal,
  type ClaimCheckInput,
  type HolderLiveness,
} from '../claim-check.js';
import type { ContinueItemsMap } from '../continue-state.js';
import type { XBriefItem } from '../types.js';
import type { LivenessVerdict } from '../../agents/liveness.js';

function item(id: string, filesScope?: string[], confidence?: 'high' | 'medium' | 'low'): XBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: filesScope ? { files_scope: filesScope, files_scope_confidence: confidence } : undefined,
  };
}

function baseInput(overrides: Partial<ClaimCheckInput> = {}): ClaimCheckInput {
  return {
    items: [item('a'), item('b')],
    claims: {},
    itemId: 'a',
    claimant: 'agent-y',
    liveness: new Map(),
    ...overrides,
  };
}

describe('checkClaim — held (FR-1..FR-3)', () => {
  it('refuses when the holder is alive', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-x' } };
    const result = checkClaim(baseInput({ claims, liveness: new Map([['agent-x', 'alive']]) }));
    expect(result).toEqual({ ok: false, refusal: { kind: 'held', holder: 'agent-x', liveness: 'alive' } });
  });

  it('refuses when the holder is indeterminate', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-x' } };
    const result = checkClaim(baseInput({ claims, liveness: new Map([['agent-x', 'indeterminate']]) }));
    expect(result).toEqual({
      ok: false,
      refusal: { kind: 'held', holder: 'agent-x', liveness: 'indeterminate' },
    });
  });

  it('a missing liveness entry for the holder is treated as indeterminate', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-x' } };
    const result = checkClaim(baseInput({ claims, liveness: new Map() }));
    expect(result).toEqual({
      ok: false,
      refusal: { kind: 'held', holder: 'agent-x', liveness: 'indeterminate' },
    });
  });

  it('allows the claim when the holder is dead', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-x' } };
    const result = checkClaim(baseInput({ claims, liveness: new Map([['agent-x', 'dead']]) }));
    expect(result).toEqual({ ok: true, overridden: [] });
  });

  it('allows a re-claim by the same holder regardless of liveness', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-y' } };
    const result = checkClaim(baseInput({ claims, claimant: 'agent-y', liveness: new Map() }));
    expect(result).toEqual({ ok: true, overridden: [] });
  });

  it('ignores completed and cancelled claims', () => {
    const claims: ContinueItemsMap = {
      a: { status: 'completed', claimedBy: 'agent-x' },
    };
    expect(checkClaim(baseInput({ claims, liveness: new Map([['agent-x', 'alive']]) }))).toEqual({
      ok: true,
      overridden: [],
    });

    const cancelledClaims: ContinueItemsMap = { a: { status: 'cancelled', claimedBy: 'agent-x' } };
    expect(
      checkClaim(baseInput({ claims: cancelledClaims, liveness: new Map([['agent-x', 'alive']]) })),
    ).toEqual({ ok: true, overridden: [] });
  });
});

describe('checkClaim — overlap (FR-4)', () => {
  it('refuses when files_scope overlaps a live holder\'s scope, naming the item and the shared path', () => {
    const claims: ContinueItemsMap = { other: { status: 'in_progress', claimedBy: 'agent-x' } };
    const items = [item('target', ['src/a/x.ts']), item('other', ['src/a/**'])];
    const result = checkClaim({
      items,
      claims,
      itemId: 'target',
      claimant: 'agent-y',
      liveness: new Map([['agent-x', 'alive']]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.refusal.kind).toBe('overlap');
    if (result.refusal.kind !== 'overlap') throw new Error('expected overlap refusal');
    expect(result.refusal.conflictingItemId).toBe('other');
    expect(result.refusal.holder).toBe('agent-x');
    expect(result.refusal.lowConfidence).toBe(false);
    expect(result.refusal.sharedPaths).toContain('src/a/x.ts');
  });

  it('allows a claim with a disjoint files_scope', () => {
    const claims: ContinueItemsMap = { other: { status: 'in_progress', claimedBy: 'agent-x' } };
    const items = [item('target', ['src/c/**']), item('other', ['src/a/**'])];
    const result = checkClaim({
      items,
      claims,
      itemId: 'target',
      claimant: 'agent-y',
      liveness: new Map([['agent-x', 'alive']]),
    });
    expect(result).toEqual({ ok: true, overridden: [] });
  });

  it('treats a low-confidence scope on either side as overlapping', () => {
    const claims: ContinueItemsMap = { other: { status: 'in_progress', claimedBy: 'agent-x' } };
    const items = [item('target', ['src/c/**']), item('other', ['src/a/**'], 'low')];
    const result = checkClaim({
      items,
      claims,
      itemId: 'target',
      claimant: 'agent-y',
      liveness: new Map([['agent-x', 'alive']]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.refusal).toEqual({
      kind: 'overlap',
      holder: 'agent-x',
      liveness: 'alive',
      conflictingItemId: 'other',
      sharedPaths: [],
      lowConfidence: true,
    });
  });

  it('the overlap set includes other items held by the claimant itself', () => {
    const claims: ContinueItemsMap = { other: { status: 'in_progress', claimedBy: 'agent-y' } };
    const items = [item('target', ['src/a/x.ts']), item('other', ['src/a/**'])];
    const result = checkClaim({
      items,
      claims,
      itemId: 'target',
      claimant: 'agent-y',
      liveness: new Map(),
    });
    expect(result.ok).toBe(false);
  });

  it('skips a conflicting claim key with no matching plan item', () => {
    const claims: ContinueItemsMap = { ghost: { status: 'in_progress', claimedBy: 'agent-x' } };
    const items = [item('target', ['src/a/x.ts'])];
    const result = checkClaim({
      items,
      claims,
      itemId: 'target',
      claimant: 'agent-y',
      liveness: new Map([['agent-x', 'alive']]),
    });
    expect(result).toEqual({ ok: true, overridden: [] });
  });
});

describe('checkClaim — --steal (FR-9)', () => {
  it('overrides a held refusal and lists it in overridden', () => {
    const claims: ContinueItemsMap = { a: { status: 'in_progress', claimedBy: 'agent-x' } };
    const result = checkClaim(
      baseInput({ claims, liveness: new Map([['agent-x', 'alive']]), steal: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.overridden.length).toBe(1);
    expect(result.overridden[0]).toEqual({ kind: 'held', holder: 'agent-x', liveness: 'alive' });
  });

  it('returns overridden: [] when steal is set but nothing was refused', () => {
    const result = checkClaim(baseInput({ steal: true }));
    expect(result).toEqual({ ok: true, overridden: [] });
  });
});

describe('resolveClaimantId (FR-6)', () => {
  it('prefers OVERDECK_CLAIM_ID', () => {
    expect(
      resolveClaimantId({ OVERDECK_CLAIM_ID: 'pan-1-item-a', OVERDECK_AGENT_ID: 'agent-x' }, 123),
    ).toBe('pan-1-item-a');
  });

  it('falls back to OVERDECK_AGENT_ID', () => {
    expect(resolveClaimantId({ OVERDECK_AGENT_ID: 'agent-x' }, 123)).toBe('agent-x');
  });

  it('falls back to cli-<pid> when neither is set', () => {
    expect(resolveClaimantId({}, 123)).toBe('cli-123');
  });

  it('skips empty-string values', () => {
    expect(resolveClaimantId({ OVERDECK_CLAIM_ID: '', OVERDECK_AGENT_ID: '' }, 123)).toBe('cli-123');
  });
});

describe('holdersToProbe', () => {
  it('excludes the claimant and de-duplicates, sorted', () => {
    const claims: ContinueItemsMap = {
      a: { status: 'in_progress', claimedBy: 'agent-b' },
      b: { status: 'in_progress', claimedBy: 'agent-a' },
      c: { status: 'in_progress', claimedBy: 'agent-a' },
      d: { status: 'in_progress', claimedBy: 'agent-y' },
      e: { status: 'completed', claimedBy: 'agent-c' },
    };
    expect(holdersToProbe(claims, 'agent-y')).toEqual(['agent-a', 'agent-b']);
  });
});

describe('probeHolder (FR-8)', () => {
  it('classifies a cli- holder dead without calling the probe', async () => {
    const spy = vi.fn<(agentId: string) => Promise<LivenessVerdict>>();
    const result = await probeHolder('cli-123', spy);
    expect(result).toBe('dead');
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps an alive verdict to alive', async () => {
    const verdict: LivenessVerdict = { alive: true, paneAlive: true };
    const result = await probeHolder('agent-x', async () => verdict);
    expect(result).toBe('alive');
  });

  it('maps runtime-indeterminate to indeterminate', async () => {
    const verdict: LivenessVerdict = { alive: false, reason: 'runtime-indeterminate' };
    const result = await probeHolder('agent-x', async () => verdict);
    expect(result).toBe('indeterminate');
  });

  it('maps no-session to dead', async () => {
    const verdict: LivenessVerdict = { alive: false, reason: 'no-session' };
    const result = await probeHolder('agent-x', async () => verdict);
    expect(result).toBe('dead');
  });
});

describe('formatClaimRefusal (NFR-6)', () => {
  it('held/alive names the holder and both exits', () => {
    const message = formatClaimRefusal('PAN-1-a', { kind: 'held', holder: 'agent-x', liveness: 'alive' });
    expect(message).toBe(
      'PAN-1-a is claimed by agent-x, which is still running. Nothing was written. ' +
        'Run "pan task next" to pick another item, or pass --steal if agent-x is stuck.',
    );
  });

  it('held/indeterminate names the holder and both exits', () => {
    const message = formatClaimRefusal('PAN-1-a', {
      kind: 'held',
      holder: 'agent-x',
      liveness: 'indeterminate',
    });
    expect(message).toBe(
      'PAN-1-a is claimed by agent-x, and Overdeck could not tell whether agent-x is still running ' +
        '(the terminal backend did not answer). Nothing was written. ' +
        'Run "pan task next" to pick another item, or pass --steal if you know agent-x is gone.',
    );
  });

  it('overlap names the conflicting item, holder, and shared paths', () => {
    const message = formatClaimRefusal('PAN-1-b', {
      kind: 'overlap',
      holder: 'agent-x',
      liveness: 'alive',
      conflictingItemId: 'PAN-1-a',
      sharedPaths: ['src/a/x.ts'],
      lowConfidence: false,
    });
    expect(message).toBe(
      'PAN-1-b shares files with PAN-1-a, which agent-x has claimed and is still running: src/a/x.ts. ' +
        'Two workers editing the same files overwrite each other, so nothing was written. ' +
        'Wait for PAN-1-a to finish, run "pan task next" to pick another item, or pass --steal to claim it anyway.',
    );
  });

  it('overlap/lowConfidence explains the reason and gives the same two exits', () => {
    const message = formatClaimRefusal('PAN-1-b', {
      kind: 'overlap',
      holder: 'agent-x',
      liveness: 'alive',
      conflictingItemId: 'PAN-1-a',
      sharedPaths: [],
      lowConfidence: true,
    });
    expect(message).toBe(
      'PAN-1-b cannot run beside PAN-1-a (claimed by agent-x, still running): one of them has a ' +
        'low-confidence files_scope, so Overdeck cannot prove they touch different files. Nothing was written. ' +
        'Wait for PAN-1-a to finish, run "pan task next" to pick another item, or pass --steal to claim it anyway.',
    );
  });
});

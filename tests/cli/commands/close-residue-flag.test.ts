import { describe, expect, it } from 'vitest';
import { checkResidueFlagEligibility } from '../../../src/cli/commands/close.js';

describe('checkResidueFlagEligibility', () => {
  it('returns null for eligible conv-* caller with residue reason', () => {
    const result = checkResidueFlagEligibility({
      residueReason: 'pre-record-era stale PR',
      abandonRequested: false,
      dodAcceptedRows: [],
      agentId: 'conv-user',
    });
    expect(result).toBeNull();
  });

  it('rejects empty reason', () => {
    const result = checkResidueFlagEligibility({
      residueReason: '   ',
      abandonRequested: false,
      dodAcceptedRows: [],
      agentId: 'conv-user',
    });
    expect(result).toContain('non-empty reason');
  });

  it('rejects combination with --abandon', () => {
    const result = checkResidueFlagEligibility({
      residueReason: 'reason',
      abandonRequested: true,
      dodAcceptedRows: [],
      agentId: 'conv-user',
    });
    expect(result).toContain('--abandon');
  });

  it('rejects combination with --accept-* flags', () => {
    const result = checkResidueFlagEligibility({
      residueReason: 'reason',
      abandonRequested: false,
      dodAcceptedRows: ['review', 'tests'],
      agentId: 'conv-user',
    });
    expect(result).toContain('--accept-*');
  });

  it('rejects non-conv-* agent id', () => {
    const result = checkResidueFlagEligibility({
      residueReason: 'reason',
      abandonRequested: false,
      dodAcceptedRows: [],
      agentId: 'agent-pan-123',
    });
    expect(result).toContain('operator-conversation-only');
  });

  it('rejects flywheel agent id', () => {
    const result = checkResidueFlagEligibility({
      residueReason: 'reason',
      abandonRequested: false,
      dodAcceptedRows: [],
      agentId: 'flywheel-orchestrator',
    });
    expect(result).toContain('operator-conversation-only');
  });

  it('returns null when no residue reason (null check)', () => {
    const result = checkResidueFlagEligibility({
      residueReason: null,
      abandonRequested: false,
      dodAcceptedRows: [],
      agentId: 'flywheel-orchestrator',
    });
    expect(result).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { formatPrdGateFailureMessage } from '../../../src/cli/commands/plan-finalize.js';

/**
 * PAN-4224 WI-5: the PRD-first gate failure message must name the workspace
 * draft path — the location the running agent actually writes to now that
 * promotion targets the workspace, not the primary checkout.
 */
describe('formatPrdGateFailureMessage', () => {
  it('names the workspace draft path for a missing PRD', () => {
    const message = formatPrdGateFailureMessage('PAN-9', { ok: false, reason: 'missing', searched: [] }, '/tmp/ws');

    expect(message).toContain('/tmp/ws/.pan/drafts/pan-9.md');
  });

  it('reports the found-but-too-short path unchanged, ignoring the draft root hint', () => {
    const message = formatPrdGateFailureMessage(
      'PAN-9',
      { ok: false, reason: 'too-short', path: '/tmp/ws/.pan/drafts/pan-9.md', lineCount: 3 },
      '/tmp/ws',
    );

    expect(message).toContain('/tmp/ws/.pan/drafts/pan-9.md');
    expect(message).toContain('too short');
  });

  it('falls back to a bare relative path when there is no draft root hint', () => {
    const message = formatPrdGateFailureMessage('PAN-9', { ok: false, reason: 'missing', searched: [] }, null);

    expect(message).toContain('.pan/drafts/PAN-9.md');
  });
});

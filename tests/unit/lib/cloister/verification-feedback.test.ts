import { describe, expect, it } from 'vitest';

import { buildFinalFailureInstructions } from '../../../../src/lib/cloister/verification-feedback.js';

describe('terminal verification feedback', () => {
  it('returns corrected work to the normal pipeline instead of forbidding resubmission', () => {
    const instructions = buildFinalFailureInstructions('PAN-2597');

    expect(instructions).toContain('pan done PAN-2597');
    expect(instructions).toContain('resets verification');
    expect(instructions).not.toContain('final allowed verification attempt');
    expect(instructions).not.toContain('Do not re-request review');
  });
});

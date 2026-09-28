import { describe, expect, it } from 'vitest';
import { inputTargetNotice } from '../subagentRouting';

describe('inputTargetNotice (PAN-4268)', () => {
  it('shows no notice when input goes to main, is unknown, or was not checked', () => {
    expect(inputTargetNotice('main')).toBeNull();
    expect(inputTargetNotice('unknown')).toBeNull();
    expect(inputTargetNotice(undefined)).toBeNull();
  });

  it('names the subagent the selector shows receiving typed input', () => {
    expect(inputTargetNotice({ subagent: 'Counter run' })).toEqual({ description: 'Counter run' });
  });
});

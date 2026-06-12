import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reviewValidateTraceCommand } from '../../../../src/cli/commands/review-validate-trace.js';

const FIXTURES = {
  pass: 'tests/fixtures/review-requirements/happy-path.md',
  fail: 'tests/fixtures/review-requirements/missing-section.md',
};

describe('reviewValidateTraceCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as (code?: number) => never);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 0 when the trace validation passes', async () => {
    await reviewValidateTraceCommand(FIXTURES.pass);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('exits 1 with the validator reason on stderr when validation fails', async () => {
    await reviewValidateTraceCommand(FIXTURES.fail);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const reason = stderrSpy.mock.calls[0][0] as string;
    expect(reason).toContain('requirements review missing live code path trace for ACs:');
    expect(reason).toContain('AC-1: Foo does the thing');
  });
});

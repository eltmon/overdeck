import { describe, expect, it } from 'vitest';
import { buildResumeContract } from '../resume-contract.js';

describe('resume contract', () => {
  it('distinguishes operator resumes from system recovery', () => {
    expect(buildResumeContract('operator')).toContain('operator resumed this session');
    expect(buildResumeContract('system')).toContain('prior process ended unexpectedly');
  });

  it('names the process-local machinery that must be restored', () => {
    const contract = buildResumeContract('system');
    expect(contract).toContain('timers or wakeups');
    expect(contract).toContain('monitors');
    expect(contract).toContain('background processes');
    expect(contract).toContain('loops');
    expect(contract).toContain('cron');
    expect(contract).toContain('arm its next wakeup now');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tracker-utils.js', () => ({
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

import { applyIssueParkedLabel, PARKED_LABEL } from '../label-ops.js';
import { resolveGitHubIssueSync } from '../../tracker-utils.js';
import { exec } from 'node:child_process';

const mockExec = vi.mocked(exec) as unknown as ReturnType<typeof vi.fn>;
const mockResolve = vi.mocked(resolveGitHubIssueSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ stdout: '', stderr: '' });
});

describe('applyIssueParkedLabel – FR-15 parked label on gate=blocked', () => {
  it('calls gh issue edit with parked label when issue resolves to GitHub', async () => {
    mockResolve.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', prefix: 'PAN', number: 1866 });

    await applyIssueParkedLabel('PAN-1866');

    expect(mockExec).toHaveBeenCalledOnce();
    const [cmd] = mockExec.mock.calls[0] as [string, ...unknown[]];
    expect(cmd).toContain('gh issue edit 1866');
    expect(cmd).toContain('--repo eltmon/overdeck');
    expect(cmd).toContain(`--add-label "${PARKED_LABEL}"`);
  });

  it('is a no-op when the issue is not a GitHub issue', async () => {
    mockResolve.mockReturnValue({ isGitHub: false });

    await applyIssueParkedLabel('MIN-999');

    expect(mockExec).not.toHaveBeenCalled();
  });

  it('resolves the issueId via resolveGitHubIssueSync', async () => {
    mockResolve.mockReturnValue({ isGitHub: true, owner: 'acme', repo: 'myproject', prefix: 'ACME', number: 42 });

    await applyIssueParkedLabel('ACME-42');

    expect(mockResolve).toHaveBeenCalledWith('ACME-42');
    const [cmd] = mockExec.mock.calls[0] as [string, ...unknown[]];
    expect(cmd).toContain('gh issue edit 42');
    expect(cmd).toContain('--repo acme/myproject');
  });
});

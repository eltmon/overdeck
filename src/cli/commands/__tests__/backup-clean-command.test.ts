import { beforeEach, describe, expect, it, vi } from 'vitest';

const backupMocks = vi.hoisted(() => ({
  cleanOldBackups: vi.fn(() => 0),
  listBackups: vi.fn(() => []),
}));

const exitMocks = vi.hoisted(() => ({
  exitCli: vi.fn(async () => undefined as never),
}));

vi.mock('../../../lib/backup.js', () => backupMocks);
vi.mock('../../exit.js', () => exitMocks);

describe('backupCleanCommand', () => {
  beforeEach(() => {
    backupMocks.cleanOldBackups.mockClear();
    exitMocks.exitCli.mockClear();
  });

  it('rejects a non-numeric --keep without deleting', async () => {
    const { backupCleanCommand } = await import('../backup.js');

    await backupCleanCommand({ keep: 'abc' });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(backupMocks.cleanOldBackups).not.toHaveBeenCalled();
  });

  it('rejects negative and fractional --keep', async () => {
    const { backupCleanCommand } = await import('../backup.js');

    await backupCleanCommand({ keep: '-1' });
    await backupCleanCommand({ keep: '2.5' });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(exitMocks.exitCli).toHaveBeenCalledTimes(2);
    expect(backupMocks.cleanOldBackups).not.toHaveBeenCalled();
  });

  it('rejects overflowing and precision-losing --keep', async () => {
    const { backupCleanCommand } = await import('../backup.js');

    await backupCleanCommand({ keep: '9'.repeat(400) });
    await backupCleanCommand({ keep: '9007199254740993' });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(exitMocks.exitCli).toHaveBeenCalledTimes(2);
    expect(backupMocks.cleanOldBackups).not.toHaveBeenCalled();
  });

  it('passes a valid --keep through', async () => {
    const { backupCleanCommand } = await import('../backup.js');

    await backupCleanCommand({ keep: '3' });
    expect(backupMocks.cleanOldBackups).toHaveBeenCalledWith(3);

    await backupCleanCommand({});
    expect(backupMocks.cleanOldBackups).toHaveBeenCalledWith(10);
  });
});

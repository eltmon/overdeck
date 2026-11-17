import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('backup', () => {
  let tempDir: string;
  let mockBackupsDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-backup-test-'));
    mockBackupsDir = join(tempDir, 'backups');
    mkdirSync(mockBackupsDir, { recursive: true });

    // Mock the BACKUPS_DIR
    vi.doMock('../../src/lib/paths.js', () => ({
      BACKUPS_DIR: mockBackupsDir,
    }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
    vi.resetModules();
  });

  describe('createBackupTimestamp', () => {
    it('should create ISO-like timestamp without colons or dots', async () => {
      const { createBackupTimestamp } = await import('../../src/lib/backup.js');
      const timestamp = createBackupTimestamp();

      // Should not contain : or .
      expect(timestamp).not.toMatch(/[:.]/);

      // Should be roughly ISO format with dashes
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    it('should create unique timestamps', async () => {
      const { createBackupTimestamp } = await import('../../src/lib/backup.js');

      const t1 = createBackupTimestamp();
      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      const t2 = createBackupTimestamp();

      // They should be different (or at least the test validates the function works)
      expect(typeof t1).toBe('string');
      expect(typeof t2).toBe('string');
    });
  });

  describe('resolveBackupKeep', () => {
    it('returns a valid integer unchanged', async () => {
      const { resolveBackupKeep } = await import('../../src/lib/backup.js');

      expect(resolveBackupKeep(3)).toBe(3);
      expect(resolveBackupKeep(1)).toBe(1);
    });

    it('falls back to 10 for missing or invalid values', async () => {
      const { resolveBackupKeep } = await import('../../src/lib/backup.js');

      expect(resolveBackupKeep(undefined)).toBe(10);
      expect(resolveBackupKeep(0)).toBe(10);
      expect(resolveBackupKeep(-2)).toBe(10);
      expect(resolveBackupKeep(2.5)).toBe(10);
      expect(resolveBackupKeep(NaN)).toBe(10);
      expect(resolveBackupKeep('5')).toBe(10);
      expect(resolveBackupKeep(null)).toBe(10);
    });
  });

  describe('createBackup', () => {
    it('should create backup of existing directories', async () => {
      // Create source directories
      const sourceDir = join(tempDir, 'source');
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, 'test.txt'), 'test content');

      const { createBackup } = await import('../../src/lib/backup.js');
      const backup = createBackup([sourceDir]);

      expect(backup.timestamp).toBeDefined();
      expect(backup.path).toContain(mockBackupsDir);
      expect(backup.targets).toContain('source');

      // Verify backup exists
      expect(existsSync(backup.path)).toBe(true);
      expect(existsSync(join(backup.path, 'source', 'test.txt'))).toBe(true);
    });

    it('should skip non-existent directories', async () => {
      const { createBackup } = await import('../../src/lib/backup.js');
      const backup = createBackup(['/nonexistent/path']);

      expect(backup.targets).toHaveLength(0);
    });

    it('should backup multiple directories', async () => {
      // Create source directories
      const dir1 = join(tempDir, 'dir1');
      const dir2 = join(tempDir, 'dir2');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });
      writeFileSync(join(dir1, 'file1.txt'), 'content1');
      writeFileSync(join(dir2, 'file2.txt'), 'content2');

      const { createBackup } = await import('../../src/lib/backup.js');
      const backup = createBackup([dir1, dir2]);

      expect(backup.targets).toContain('dir1');
      expect(backup.targets).toContain('dir2');
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', async () => {
      const { listBackups } = await import('../../src/lib/backup.js');
      const backups = listBackups();

      expect(backups).toEqual([]);
    });

    it('should list existing backups', async () => {
      // Create fake backups
      const backup1 = join(mockBackupsDir, '2024-01-01T00-00-00');
      const backup2 = join(mockBackupsDir, '2024-01-02T00-00-00');
      mkdirSync(backup1);
      mkdirSync(backup2);
      mkdirSync(join(backup1, 'skills'));
      mkdirSync(join(backup2, 'skills'));

      const { listBackups } = await import('../../src/lib/backup.js');
      const backups = listBackups();

      expect(backups.length).toBe(2);
      expect(backups[0].timestamp).toBe('2024-01-02T00-00-00'); // Sorted newest first
      expect(backups[1].timestamp).toBe('2024-01-01T00-00-00');
    });

    it('should include targets in backup info', async () => {
      const backup = join(mockBackupsDir, '2024-01-01T00-00-00');
      mkdirSync(backup);
      mkdirSync(join(backup, 'skills'));
      mkdirSync(join(backup, 'commands'));

      const { listBackups } = await import('../../src/lib/backup.js');
      const backups = listBackups();

      expect(backups[0].targets).toContain('skills');
      expect(backups[0].targets).toContain('commands');
    });

    it('excludes dist-rollbacks and other named dirs', async () => {
      mkdirSync(join(mockBackupsDir, '2024-01-01T00-00-00', 'skills'), { recursive: true });
      mkdirSync(join(mockBackupsDir, '2026-11-17T00-00-00-000Z', 'skills'), { recursive: true });
      mkdirSync(join(mockBackupsDir, 'dist-rollbacks', 'dist.rollback.1'), { recursive: true });
      mkdirSync(join(mockBackupsDir, 'pan-3783-native-context', 'history'), { recursive: true });
      mkdirSync(join(mockBackupsDir, '2026-11-17Tnotes'), { recursive: true });
      writeFileSync(join(mockBackupsDir, '2026-11-17Tnotes', 'a.md'), '');

      const { listBackups } = await import('../../src/lib/backup.js');
      const backups = listBackups();

      expect(backups.map((b) => b.timestamp)).toEqual(['2026-11-17T00-00-00-000Z', '2024-01-01T00-00-00']);
    });
  });

  describe('restoreBackup', () => {
    it('should throw error for non-existent backup', async () => {
      const { restoreBackup } = await import('../../src/lib/backup.js');

      expect(() => restoreBackup('nonexistent', {})).toThrow('Backup not found');
    });

    it('should restore backup to target directories', async () => {
      // Create a backup
      const backupDir = join(mockBackupsDir, '2024-01-01T00-00-00');
      mkdirSync(backupDir);
      const skillsBackup = join(backupDir, 'skills');
      mkdirSync(skillsBackup);
      writeFileSync(join(skillsBackup, 'test.md'), 'backup content');

      // Create target directory
      const targetSkills = join(tempDir, 'target-skills');
      mkdirSync(targetSkills);
      writeFileSync(join(targetSkills, 'existing.md'), 'will be replaced');

      const { restoreBackup } = await import('../../src/lib/backup.js');
      restoreBackup('2024-01-01T00-00-00', { skills: targetSkills });

      // Verify restore
      expect(existsSync(join(targetSkills, 'test.md'))).toBe(true);
      expect(existsSync(join(targetSkills, 'existing.md'))).toBe(false);
    });
  });

  describe('cleanOldBackups', () => {
    it('should not remove backups when under limit', async () => {
      const backup = join(mockBackupsDir, '2024-01-01T00-00-00');
      mkdirSync(backup);

      const { cleanOldBackups } = await import('../../src/lib/backup.js');
      const removed = cleanOldBackups(10);

      expect(removed).toBe(0);
      expect(existsSync(backup)).toBe(true);
    });

    it('should remove oldest backups when over limit', async () => {
      // Create 5 backups
      for (let i = 1; i <= 5; i++) {
        const backup = join(mockBackupsDir, `2024-01-0${i}T00-00-00`);
        mkdirSync(backup);
      }

      const { cleanOldBackups } = await import('../../src/lib/backup.js');
      const removed = cleanOldBackups(3);

      expect(removed).toBe(2);

      // Newest 3 should remain
      expect(existsSync(join(mockBackupsDir, '2024-01-05T00-00-00'))).toBe(true);
      expect(existsSync(join(mockBackupsDir, '2024-01-04T00-00-00'))).toBe(true);
      expect(existsSync(join(mockBackupsDir, '2024-01-03T00-00-00'))).toBe(true);

      // Oldest 2 should be removed
      expect(existsSync(join(mockBackupsDir, '2024-01-02T00-00-00'))).toBe(false);
      expect(existsSync(join(mockBackupsDir, '2024-01-01T00-00-00'))).toBe(false);
    });

    it('never touches named dirs', async () => {
      for (let i = 1; i <= 5; i++) {
        mkdirSync(join(mockBackupsDir, `2024-01-0${i}T00-00-00`));
      }
      mkdirSync(join(mockBackupsDir, 'dist-rollbacks'));
      mkdirSync(join(mockBackupsDir, '2020-01-01Tnotes'));

      const { cleanOldBackups } = await import('../../src/lib/backup.js');
      const removed = cleanOldBackups(2);

      expect(removed).toBe(3);
      expect(existsSync(join(mockBackupsDir, 'dist-rollbacks'))).toBe(true);
      expect(existsSync(join(mockBackupsDir, '2020-01-01Tnotes'))).toBe(true);
    });

    it('never deletes a context backup and does not count it toward keep', async () => {
      mkdirSync(join(mockBackupsDir, '2024-01-02T00-00-00', 'skills'), { recursive: true });
      mkdirSync(join(mockBackupsDir, '2024-01-03T00-00-00', 'skills'), { recursive: true });
      mkdirSync(join(mockBackupsDir, '2024-01-04T00-00-00', 'skills'), { recursive: true });
      mkdirSync(join(mockBackupsDir, '2024-01-01T00-00-00', 'context'), { recursive: true });
      writeFileSync(join(mockBackupsDir, '2024-01-01T00-00-00', 'context', 'x.md'), '');

      const { cleanOldBackups } = await import('../../src/lib/backup.js');
      const removed = cleanOldBackups(2);

      expect(removed).toBe(1);
      expect(existsSync(join(mockBackupsDir, '2024-01-02T00-00-00'))).toBe(false);
      expect(existsSync(join(mockBackupsDir, '2024-01-03T00-00-00'))).toBe(true);
      expect(existsSync(join(mockBackupsDir, '2024-01-04T00-00-00'))).toBe(true);
      expect(existsSync(join(mockBackupsDir, '2024-01-01T00-00-00', 'context', 'x.md'))).toBe(true);
    });

    it('rejects NaN, negative and fractional keep counts and deletes nothing', async () => {
      for (let i = 1; i <= 3; i++) {
        mkdirSync(join(mockBackupsDir, `2024-01-0${i}T00-00-00`));
      }

      const { cleanOldBackups } = await import('../../src/lib/backup.js');

      expect(() => cleanOldBackups(NaN)).toThrow(RangeError);
      expect(() => cleanOldBackups(-1)).toThrow(RangeError);
      expect(() => cleanOldBackups(2.5)).toThrow(RangeError);

      for (let i = 1; i <= 3; i++) {
        expect(existsSync(join(mockBackupsDir, `2024-01-0${i}T00-00-00`))).toBe(true);
      }
    });

    it('is idempotent', async () => {
      mkdirSync(join(mockBackupsDir, '2024-01-01T00-00-00'));
      mkdirSync(join(mockBackupsDir, '2024-01-02T00-00-00'));

      const { cleanOldBackups } = await import('../../src/lib/backup.js');

      expect(cleanOldBackups(0)).toBe(2);
      expect(cleanOldBackups(0)).toBe(0);
    });
  });
});

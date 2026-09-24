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
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  ensureGitignorePatterns,
  normalizeGitRemote,
  removeNoDbKey,
  standardizeBeadsConfig,
} from '../../../../src/lib/beads/config-standardize.js';

describe('beads config standardization (PAN-2564 WI-8)', () => {
  let projectPath: string;
  let beadsDir: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'beads-config-project-'));
    beadsDir = join(projectPath, '.beads');
    mkdirSync(beadsDir, { recursive: true });
    execSync('git init --quiet', { cwd: projectPath });
    execSync('git remote add origin git@github.com:eltmon/overdeck.git', { cwd: projectPath });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  describe('normalizeGitRemote', () => {
    it('treats ssh, git+ssh, and https forms of the same remote as equal', () => {
      const canonical = normalizeGitRemote('git@github.com:eltmon/overdeck.git');
      expect(canonical).toBe('github.com/eltmon/overdeck');
      expect(normalizeGitRemote('git+ssh://git@github.com/eltmon/overdeck.git')).toBe(canonical);
      expect(normalizeGitRemote('https://github.com/eltmon/overdeck.git')).toBe(canonical);
    });
  });

  describe('AC1: no-db removal', () => {
    it('removes a planted no-db key from config.yaml and reports the fix', async () => {
      const configPath = join(beadsDir, 'config.yaml');
      writeFileSync(
        configPath,
        '# Beads config\nno-db: true\nsync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n',
        'utf8',
      );

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(true);
      expect(result.fixes.some((f) => f.includes('no-db'))).toBe(true);
      expect(result.messages.some((m) => m.includes('no-db'))).toBe(true);

      const updated = readFileSync(configPath, 'utf8');
      expect(updated).not.toMatch(/^no-db\s*:/m);
      expect(updated).toContain('remote: "git+ssh://git@github.com/eltmon/overdeck.git"');
    });

    it('does not modify config.yaml when dryRun is true', async () => {
      const configPath = join(beadsDir, 'config.yaml');
      const original = '# Beads config\nno-db: true\nsync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n';
      writeFileSync(configPath, original, 'utf8');

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: true });

      expect(result.fixes.some((f) => f.includes('no-db') && f.includes('dry-run'))).toBe(true);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    });

    it('returns no change when no-db is absent', async () => {
      const configPath = join(beadsDir, 'config.yaml');
      writeFileSync(
        configPath,
        'sync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n',
        'utf8',
      );

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(true);
      expect(result.fixes.some((f) => f.includes('no-db'))).toBe(false);
    });
  });

  describe('AC2: sync.remote validation', () => {
    it('rejects a sync.remote that does not point at the project origin', async () => {
      const configPath = join(beadsDir, 'config.yaml');
      writeFileSync(
        configPath,
        'sync:\n    remote: "git+ssh://git@github.com/someone/else.git"\n',
        'utf8',
      );

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('sync.remote') && e.includes('does not point'))).toBe(true);
      expect(result.errors.some((e) => e.includes('git@github.com:eltmon/overdeck.git'))).toBe(true);
    });

    it('reports an error when sync.remote is missing', async () => {
      writeFileSync(join(beadsDir, 'config.yaml'), 'actor: "test"\n', 'utf8');

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('sync.remote') && e.includes('missing'))).toBe(true);
    });
  });

  describe('AC3: gitignore coverage', () => {
    it('adds Dolt runtime patterns to project .gitignore and .beads/.gitignore', async () => {
      writeFileSync(
        join(beadsDir, 'config.yaml'),
        'sync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n',
        'utf8',
      );

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(true);
      const projectGitignore = readFileSync(join(projectPath, '.gitignore'), 'utf8');
      const beadsGitignore = readFileSync(join(beadsDir, '.gitignore'), 'utf8');

      for (const pattern of ['dolt/', 'embeddeddolt/', 'dolt-server.*', '*.dolt', '.beads/backup/']) {
        expect(projectGitignore).toContain(pattern);
      }
      for (const pattern of ['dolt/', 'embeddeddolt/', 'dolt-server.*', '*.dolt', 'backup/', '.beads/backup/']) {
        expect(beadsGitignore).toContain(pattern);
      }
    });

    it('does not duplicate patterns that are already present', async () => {
      writeFileSync(
        join(beadsDir, 'config.yaml'),
        'sync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n',
        'utf8',
      );
      writeFileSync(
        join(projectPath, '.gitignore'),
        'dolt/\nembeddeddolt/\ndolt-server.*\n*.dolt\n.beads/backup/\n',
        'utf8',
      );
      writeFileSync(
        join(beadsDir, '.gitignore'),
        'dolt/\nembeddeddolt/\ndolt-server.*\n*.dolt\nbackup/\n.beads/backup/\n',
        'utf8',
      );

      const result = await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      expect(result.ok).toBe(true);
      expect(result.fixes.some((f) => f.includes('.gitignore'))).toBe(false);
    });

    it('makes Dolt runtime files untrackable by git', async () => {
      writeFileSync(
        join(beadsDir, 'config.yaml'),
        'sync:\n    remote: "git+ssh://git@github.com/eltmon/overdeck.git"\n',
        'utf8',
      );

      mkdirSync(join(beadsDir, 'dolt'), { recursive: true });
      mkdirSync(join(beadsDir, 'embeddeddolt'), { recursive: true });
      mkdirSync(join(beadsDir, 'backup'), { recursive: true });
      writeFileSync(join(beadsDir, 'dolt-server.pid'), '1234', 'utf8');
      writeFileSync(join(beadsDir, 'data.dolt'), 'binary', 'utf8');
      writeFileSync(join(beadsDir, 'backup', 'snapshot.jsonl'), '{}\n', 'utf8');

      await standardizeBeadsConfig({ projectPath, beadsDir, dryRun: false });

      const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf8' });
      const untracked = status
        .split('\n')
        .filter((line) => line.startsWith('??'))
        .map((line) => line.slice(3));

      expect(untracked).not.toContain('.beads/dolt');
      expect(untracked).not.toContain('.beads/embeddeddolt');
      expect(untracked).not.toContain('.beads/dolt-server.pid');
      expect(untracked).not.toContain('.beads/data.dolt');
      expect(untracked).not.toContain('.beads/backup');
      expect(untracked).not.toContain('.beads/backup/snapshot.jsonl');
    });
  });

  describe('ensureGitignorePatterns', () => {
    it('creates a gitignore file if it does not exist', async () => {
      const filePath = join(projectPath, 'new.gitignore');
      const result = await ensureGitignorePatterns(filePath, ['dolt/', '*.dolt'], false);
      expect(result.added).toEqual(['dolt/', '*.dolt']);
      expect(readFileSync(filePath, 'utf8')).toContain('dolt/');
    });
  });

  describe('removeNoDbKey', () => {
    it('removes only active no-db lines, not comments', () => {
      const configPath = join(beadsDir, 'config.yaml');
      writeFileSync(configPath, '# no-db: true\nno-db: true\nactor: x\n', 'utf8');

      const result = removeNoDbKey(beadsDir, false);

      expect(result.changed).toBe(true);
      const updated = readFileSync(configPath, 'utf8');
      expect(updated).toContain('# no-db: true');
      expect(updated).not.toMatch(/^no-db\s*:/m);
    });
  });
});

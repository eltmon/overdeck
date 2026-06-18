import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  OVERDECK_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  BACKUPS_DIR,
  COSTS_DIR,
  CONFIG_FILE,
  CLAUDE_DIR,
  SYNC_TARGET,
  INIT_DIRS,
} from '../../../src/lib/paths.js';

describe('paths', () => {
  const home = homedir();

  describe('OVERDECK_HOME', () => {
    it('should respect OVERDECK_HOME when set', () => {
      expect(OVERDECK_HOME).toBe(process.env.OVERDECK_HOME ?? join(home, '.overdeck'));
    });
  });

  describe('subdirectories', () => {
    it('should all be under OVERDECK_HOME', () => {
      expect(SKILLS_DIR.startsWith(OVERDECK_HOME)).toBe(true);
      expect(COMMANDS_DIR.startsWith(OVERDECK_HOME)).toBe(true);
      expect(AGENTS_DIR.startsWith(OVERDECK_HOME)).toBe(true);
      expect(BACKUPS_DIR.startsWith(OVERDECK_HOME)).toBe(true);
      expect(COSTS_DIR.startsWith(OVERDECK_HOME)).toBe(true);
    });

    it('should have correct names', () => {
      expect(SKILLS_DIR).toBe(join(OVERDECK_HOME, 'skills'));
      expect(COMMANDS_DIR).toBe(join(OVERDECK_HOME, 'commands'));
      expect(AGENTS_DIR).toBe(join(OVERDECK_HOME, 'agents'));
      expect(BACKUPS_DIR).toBe(join(OVERDECK_HOME, 'backups'));
      expect(COSTS_DIR).toBe(join(OVERDECK_HOME, 'costs'));
    });
  });

  describe('CONFIG_FILE', () => {
    it('should be config.toml in overdeck home', () => {
      expect(CONFIG_FILE).toBe(join(OVERDECK_HOME, 'config.toml'));
    });
  });

  describe('CLAUDE_DIR', () => {
    it('should be .claude in user home', () => {
      expect(CLAUDE_DIR).toBe(join(home, '.claude'));
    });
  });

  describe('SYNC_TARGET', () => {
    it('should have skills and commands for claude', () => {
      expect(SYNC_TARGET).toHaveProperty('skills');
      expect(SYNC_TARGET).toHaveProperty('commands');
      expect(SYNC_TARGET).toHaveProperty('agents');
    });

    it('should use correct directory patterns', () => {
      expect(SYNC_TARGET.skills).toBe(join(home, '.claude', 'skills'));
      expect(SYNC_TARGET.commands).toBe(join(home, '.claude', 'commands'));
    });
  });

  describe('INIT_DIRS', () => {
    it('should contain all required directories', () => {
      expect(INIT_DIRS).toContain(OVERDECK_HOME);
      expect(INIT_DIRS).toContain(SKILLS_DIR);
      expect(INIT_DIRS).toContain(COMMANDS_DIR);
      expect(INIT_DIRS).toContain(AGENTS_DIR);
      expect(INIT_DIRS).toContain(BACKUPS_DIR);
      expect(INIT_DIRS).toContain(COSTS_DIR);
    });

    it('should be an array', () => {
      expect(Array.isArray(INIT_DIRS)).toBe(true);
    });
  });
});

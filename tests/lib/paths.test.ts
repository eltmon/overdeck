import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  PANOPTICON_HOME,
  CONFIG_DIR,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  BACKUPS_DIR,
  COSTS_DIR,
  CONFIG_FILE,
  CLAUDE_DIR,
  CODEX_DIR,
  CURSOR_DIR,
  GEMINI_DIR,
  SYNC_TARGETS,
  TEMPLATES_DIR,
  CLAUDE_MD_TEMPLATES,
  INIT_DIRS,
  CERTS_DIR,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
} from '../../src/lib/paths.js';

describe('paths', () => {
  const home = homedir();

  describe('PANOPTICON_HOME', () => {
    it('should be in home directory', () => {
      expect(PANOPTICON_HOME).toBe(join(home, '.panopticon'));
    });
  });

  describe('Subdirectories', () => {
    it('should have correct paths', () => {
      expect(CONFIG_DIR).toBe(PANOPTICON_HOME);
      expect(SKILLS_DIR).toBe(join(PANOPTICON_HOME, 'skills'));
      expect(COMMANDS_DIR).toBe(join(PANOPTICON_HOME, 'commands'));
      expect(AGENTS_DIR).toBe(join(PANOPTICON_HOME, 'agents'));
      expect(BACKUPS_DIR).toBe(join(PANOPTICON_HOME, 'backups'));
      expect(COSTS_DIR).toBe(join(PANOPTICON_HOME, 'costs'));
    });
  });

  describe('CONFIG_FILE', () => {
    it('should be config.toml in config dir', () => {
      expect(CONFIG_FILE).toBe(join(PANOPTICON_HOME, 'config.toml'));
    });
  });

  describe('AI tool directories', () => {
    it('should have correct paths', () => {
      expect(CLAUDE_DIR).toBe(join(home, '.claude'));
      expect(CODEX_DIR).toBe(join(home, '.codex'));
      expect(CURSOR_DIR).toBe(join(home, '.cursor'));
      expect(GEMINI_DIR).toBe(join(home, '.gemini'));
    });
  });

  describe('SYNC_TARGETS', () => {
    it('should have claude target', () => {
      expect(SYNC_TARGETS.claude).toBeDefined();
      expect(SYNC_TARGETS.claude.skills).toBe(join(home, '.claude', 'skills'));
      expect(SYNC_TARGETS.claude.commands).toBe(join(home, '.claude', 'commands'));
    });

    it('should have codex target', () => {
      expect(SYNC_TARGETS.codex).toBeDefined();
      expect(SYNC_TARGETS.codex.skills).toBe(join(home, '.codex', 'skills'));
    });

    it('should have cursor target', () => {
      expect(SYNC_TARGETS.cursor).toBeDefined();
      expect(SYNC_TARGETS.cursor.skills).toBe(join(home, '.cursor', 'skills'));
    });

    it('should have gemini target', () => {
      expect(SYNC_TARGETS.gemini).toBeDefined();
      expect(SYNC_TARGETS.gemini.skills).toBe(join(home, '.gemini', 'skills'));
    });
  });

  describe('Templates', () => {
    it('should have correct paths', () => {
      expect(TEMPLATES_DIR).toBe(join(PANOPTICON_HOME, 'templates'));
      expect(CLAUDE_MD_TEMPLATES).toBe(join(PANOPTICON_HOME, 'templates', 'claude-md', 'sections'));
    });
  });

  describe('INIT_DIRS', () => {
    it('should contain all required directories', () => {
      expect(INIT_DIRS).toContain(PANOPTICON_HOME);
      expect(INIT_DIRS).toContain(SKILLS_DIR);
      expect(INIT_DIRS).toContain(COMMANDS_DIR);
      expect(INIT_DIRS).toContain(AGENTS_DIR);
      expect(INIT_DIRS).toContain(BACKUPS_DIR);
      expect(INIT_DIRS).toContain(COSTS_DIR);
      expect(INIT_DIRS).toContain(TEMPLATES_DIR);
      expect(INIT_DIRS).toContain(CLAUDE_MD_TEMPLATES);
      expect(INIT_DIRS).toContain(CERTS_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_DYNAMIC_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_CERTS_DIR);
    });

    it('should have correct number of directories', () => {
      expect(INIT_DIRS.length).toBe(14);
    });
  });
});

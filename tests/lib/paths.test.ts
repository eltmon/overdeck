import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  OVERDECK_HOME,
  CONFIG_DIR,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  BACKUPS_DIR,
  COSTS_DIR,
  CONFIG_FILE,
  CLAUDE_DIR,
  LEGACY_RUNTIME_DIRS,
  SYNC_TARGET,
  TEMPLATES_DIR,
  CLAUDE_MD_TEMPLATES,
  INIT_DIRS,
  CERTS_DIR,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
  BIN_DIR,
  HEARTBEATS_DIR,
  CACHE_AGENTS_DIR,
  CACHE_RULES_DIR,
  DOCS_DIR,
  PRDS_DIR,
  PRD_DRAFTS_DIR,
  PRD_PUBLISHED_DIR,
} from '../../src/lib/paths.js';

describe('paths', () => {
  const home = homedir();

  describe('OVERDECK_HOME', () => {
    it('should respect OVERDECK_HOME when set', () => {
      expect(OVERDECK_HOME).toBe(process.env.OVERDECK_HOME ?? join(home, '.overdeck'));
    });
  });

  describe('Subdirectories', () => {
    it('should have correct paths', () => {
      expect(CONFIG_DIR).toBe(OVERDECK_HOME);
      expect(SKILLS_DIR).toBe(join(OVERDECK_HOME, 'skills'));
      expect(COMMANDS_DIR).toBe(join(OVERDECK_HOME, 'commands'));
      expect(AGENTS_DIR).toBe(join(OVERDECK_HOME, 'agents'));
      expect(BACKUPS_DIR).toBe(join(OVERDECK_HOME, 'backups'));
      expect(COSTS_DIR).toBe(join(OVERDECK_HOME, 'costs'));
    });
  });

  describe('CONFIG_FILE', () => {
    it('should be config.toml in config dir', () => {
      expect(CONFIG_FILE).toBe(join(OVERDECK_HOME, 'config.toml'));
    });
  });

  describe('CLAUDE_DIR', () => {
    it('should be .claude in user home', () => {
      expect(CLAUDE_DIR).toBe(join(home, '.claude'));
    });
  });

  describe('LEGACY_RUNTIME_DIRS', () => {
    it('should have correct paths for legacy runtimes', () => {
      expect(LEGACY_RUNTIME_DIRS.codex).toBe(join(home, '.codex'));
      expect(LEGACY_RUNTIME_DIRS.cursor).toBe(join(home, '.cursor'));
      expect(LEGACY_RUNTIME_DIRS.gemini).toBe(join(home, '.gemini'));
      expect(LEGACY_RUNTIME_DIRS.opencode).toBe(join(home, '.opencode'));
    });
  });

  describe('SYNC_TARGET', () => {
    it('should have claude target paths', () => {
      expect(SYNC_TARGET).toBeDefined();
      expect(SYNC_TARGET.skills).toBe(join(home, '.claude', 'skills'));
      expect(SYNC_TARGET.commands).toBe(join(home, '.claude', 'commands'));
      expect(SYNC_TARGET.agents).toBe(join(home, '.claude', 'agents'));
    });
  });

  describe('Templates', () => {
    it('should have correct paths', () => {
      expect(TEMPLATES_DIR).toBe(join(OVERDECK_HOME, 'templates'));
      expect(CLAUDE_MD_TEMPLATES).toBe(join(OVERDECK_HOME, 'templates', 'claude-md', 'sections'));
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
      expect(INIT_DIRS).toContain(TEMPLATES_DIR);
      expect(INIT_DIRS).toContain(CLAUDE_MD_TEMPLATES);
      expect(INIT_DIRS).toContain(CERTS_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_DYNAMIC_DIR);
      expect(INIT_DIRS).toContain(TRAEFIK_CERTS_DIR);
      expect(INIT_DIRS).toContain(BIN_DIR);
      expect(INIT_DIRS).toContain(HEARTBEATS_DIR);
      expect(INIT_DIRS).toContain(CACHE_AGENTS_DIR);
      expect(INIT_DIRS).toContain(CACHE_RULES_DIR);
      expect(INIT_DIRS).toContain(DOCS_DIR);
      expect(INIT_DIRS).toContain(PRDS_DIR);
      expect(INIT_DIRS).toContain(PRD_DRAFTS_DIR);
      expect(INIT_DIRS).toContain(PRD_PUBLISHED_DIR);
    });

    it('should have correct number of directories', () => {
      expect(INIT_DIRS.length).toBe(20);
    });
  });
});

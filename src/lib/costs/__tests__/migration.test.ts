/**
 * Migration Safety Tests - CRITICAL for data integrity
 *
 * Tests verify that migration doesn't lose data and handles all edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateAllSessionsSync } from '../migration.js';
import { readEventsSync, eventsFileExists, getLastEventMetadataSync } from '../events.js';
import { loadCacheSync, rebuildCacheSync } from '../aggregator.js';

// Test directory setup
const TEST_ROOT = join(tmpdir(), `panopticon-test-${Date.now()}`);
const TEST_AGENTS_DIR = join(TEST_ROOT, '.panopticon', 'agents');
const TEST_CLAUDE_DIR = join(TEST_ROOT, '.claude', 'projects');
const TEST_COSTS_DIR = join(TEST_ROOT, '.panopticon', 'costs');

// Mock homedir to use test directory
const originalHomedir = process.env.HOME;

beforeEach(() => {
  // Set up test directories
  mkdirSync(TEST_AGENTS_DIR, { recursive: true });
  mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
  mkdirSync(TEST_COSTS_DIR, { recursive: true });

  // Mock HOME to test directory
  process.env.HOME = TEST_ROOT;
});

afterEach(() => {
  // Restore HOME
  process.env.HOME = originalHomedir;

  // Clean up test directories
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
});

describe('Migration Safety Tests', () => {
  describe('Empty State Migration', () => {
    it('should handle empty state gracefully (no agents)', () => {
      const stats = migrateAllSessionsSync();

      expect(stats.agentsProcessed).toBe(0);
      expect(stats.sessionFilesProcessed).toBe(0);
      expect(stats.subagentFilesProcessed).toBe(0);
      expect(stats.eventsCreated).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.errors).toHaveLength(0);
    });

    it('should handle agent with no workspace', () => {
      // Create agent with no workspace field
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-1');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({ issueId: 'TEST-1' })
      );

      const stats = migrateAllSessionsSync();

      expect(stats.agentsProcessed).toBe(0);
      expect(stats.warnings.length).toBeGreaterThan(0);
      expect(stats.warnings[0].message).toContain('workspace');
    });

    it('should handle agent with missing session directory', () => {
      // Create agent with workspace that doesn't exist
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-2');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-2',
          workspace: '/nonexistent/path'
        })
      );

      const stats = migrateAllSessionsSync();

      expect(stats.warnings.length).toBeGreaterThan(0);
      expect(stats.warnings.some(w => w.message.includes('No session directory found'))).toBe(true);
    });
  });

  describe('Corrupted Data Handling', () => {
    it('should skip corrupted state.json files', () => {
      const agentDir = join(TEST_AGENTS_DIR, 'agent-corrupt');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        'invalid json {{'
      );

      const stats = migrateAllSessionsSync();

      expect(stats.errors.length).toBeGreaterThan(0);
      expect(stats.errors[0].error).toContain('parse');
    });

    it('should skip corrupted session JSONL lines', () => {
      // Create agent
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-3');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-3',
          workspace: '/test/workspaces/feature-test-3'
        })
      );

      // Create session directory with corrupted data
      const sessionDir = join(TEST_CLAUDE_DIR, '-test-workspaces-feature-test-3');
      mkdirSync(sessionDir);
      writeFileSync(
        join(sessionDir, 'session.jsonl'),
        'valid json\n{"invalid": json}\n{"usage": {"input_tokens": 100}}\n'
      );

      const stats = migrateAllSessionsSync();

      // Should continue despite corrupted lines
      expect(stats.sessionFilesProcessed).toBe(1);
      // Should not throw, just skip bad lines
    });
  });

  describe('Subagent Cost Inclusion', () => {
    it('should include subagent costs in migration', () => {
      // Create main agent
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-4');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-4',
          workspace: '/test/workspaces/feature-test-4'
        })
      );

      // Create session with main and subagent files
      const sessionDir = join(TEST_CLAUDE_DIR, '-test-workspaces-feature-test-4');
      const subagentsDir = join(sessionDir, 'subagents');
      mkdirSync(subagentsDir, { recursive: true });

      // Main session
      writeFileSync(
        join(sessionDir, 'main.jsonl'),
        JSON.stringify({
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50
          }
        })
      );

      // Subagent session
      writeFileSync(
        join(subagentsDir, 'subagent-1.jsonl'),
        JSON.stringify({
          model: 'claude-haiku-4-5',
          usage: {
            input_tokens: 500,
            output_tokens: 250,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0
          }
        })
      );

      const stats = migrateAllSessionsSync();

      expect(stats.sessionFilesProcessed).toBe(1);
      expect(stats.subagentFilesProcessed).toBe(1);
      expect(stats.eventsCreated).toBe(2); // Main + subagent
      expect(stats.totalCost).toBeGreaterThan(0);
    });
  });

  describe('Idempotency', () => {
    it('should produce same results when run twice', () => {
      // Create test data
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-5');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-5',
          workspace: '/test/workspaces/feature-test-5'
        })
      );

      const sessionDir = join(TEST_CLAUDE_DIR, '-test-workspaces-feature-test-5');
      mkdirSync(sessionDir);
      writeFileSync(
        join(sessionDir, 'session.jsonl'),
        JSON.stringify({
          model: 'claude-sonnet-4',
          usage: { input_tokens: 1000, output_tokens: 500 }
        })
      );

      // First migration
      const stats1 = migrateAllSessionsSync();
      const events1 = readEventsSync();
      const cache1 = rebuildCacheSync();

      // Clear events file for second run
      const eventsFile = join(TEST_COSTS_DIR, 'events.jsonl');
      if (existsSync(eventsFile)) {
        unlinkSync(eventsFile);
      }

      // Second migration
      const stats2 = migrateAllSessionsSync();
      const events2 = readEventsSync();
      const cache2 = rebuildCacheSync();

      // Should produce identical results
      expect(stats1.eventsCreated).toBe(stats2.eventsCreated);
      expect(stats1.totalCost).toBeCloseTo(stats2.totalCost, 6);
      expect(events1.length).toBe(events2.length);
      expect(cache1.issues['TEST-5']?.totalCost).toBeCloseTo(
        cache2.issues['TEST-5']?.totalCost || 0,
        6
      );
    });
  });

  describe('Partial State Recovery', () => {
    it('should handle partially migrated state', () => {
      // Create agent
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-6');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-6',
          workspace: '/test/workspaces/feature-test-6'
        })
      );

      const sessionDir = join(TEST_CLAUDE_DIR, '-test-workspaces-feature-test-6');
      mkdirSync(sessionDir);
      writeFileSync(
        join(sessionDir, 'session.jsonl'),
        JSON.stringify({
          model: 'claude-sonnet-4',
          usage: { input_tokens: 1000, output_tokens: 500 }
        })
      );

      // Partially migrate (create some events)
      const eventsFile = join(TEST_COSTS_DIR, 'events.jsonl');
      writeFileSync(
        eventsFile,
        JSON.stringify({
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-test-6',
          issueId: 'TEST-6',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 500,
          output: 250,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.001
        }) + '\n'
      );

      // Run migration again (should add new events without duplicating)
      const stats = migrateAllSessionsSync();

      // Should have processed the agent
      expect(stats.agentsProcessed).toBe(1);
      expect(stats.eventsCreated).toBeGreaterThan(0);
    });
  });

  describe('Cost Calculation Accuracy', () => {
    it('should calculate costs correctly for all token types', () => {
      const agentDir = join(TEST_AGENTS_DIR, 'agent-test-7');
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'state.json'),
        JSON.stringify({
          issueId: 'TEST-7',
          workspace: '/test/workspaces/feature-test-7'
        })
      );

      const sessionDir = join(TEST_CLAUDE_DIR, '-test-workspaces-feature-test-7');
      mkdirSync(sessionDir);

      // Known values for testing
      const inputTokens = 10000;
      const outputTokens = 5000;
      const cacheReadTokens = 2000;
      const cacheWriteTokens = 1000;

      // Sonnet-4 pricing: input $3/MTok, output $15/MTok, cache read $0.30/MTok, cache write $3.75/MTok (5m)
      // Expected cost: (10000/1000000)*3 + (5000/1000000)*15 + (2000/1000000)*0.30 + (1000/1000000)*3.75
      //              = 0.03 + 0.075 + 0.0006 + 0.00375 = 0.10935

      writeFileSync(
        join(sessionDir, 'session.jsonl'),
        JSON.stringify({
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadTokens,
            cache_creation_input_tokens: cacheWriteTokens
          }
        })
      );

      const stats = migrateAllSessionsSync();

      expect(stats.eventsCreated).toBe(1);
      // Verify cost is calculated correctly (allow small floating point difference)
      expect(stats.totalCost).toBeCloseTo(0.10935, 5);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for PAN-154: Deacon Agent State Cleanup & Idle Detection Fix
 *
 * Tests are structured to directly test the helper functions
 * (isAgentActiveInTmux, cleanupStaleAgentState, checkLazyAgent)
 * with focused mocking.
 */

describe('PAN-154: isAgentActiveInTmux', () => {
  // Test the active status pattern matching directly
  const ACTIVE_STATUS_PATTERNS = [
    /computing/i,
    /fermenting/i,
    /thinking/i,
    /reading/i,
    /writing/i,
    /editing/i,
    /searching/i,
    /running/i,
    /executing/i,
    /tool use/i,
    /\bBash\b/,
    /\bRead\b/,
    /\bWrite\b/,
    /\bEdit\b/,
    /\bGrep\b/,
    /\bGlob\b/,
    /\bTask\b/,
  ];

  function matchesActivePattern(output: string): boolean {
    if (!output.trim()) return false;
    for (const pattern of ACTIVE_STATUS_PATTERNS) {
      if (pattern.test(output)) return true;
    }
    return false;
  }

  it('should detect Computing status as active', () => {
    expect(matchesActivePattern('some output\nComputing…\n')).toBe(true);
  });

  it('should detect Thinking status as active', () => {
    expect(matchesActivePattern('some output\nThinking…\n')).toBe(true);
  });

  it('should detect Reading status as active', () => {
    expect(matchesActivePattern('previous lines\nReading file.ts\n')).toBe(true);
  });

  it('should detect Fermenting status as active', () => {
    expect(matchesActivePattern('Fermenting…\n')).toBe(true);
  });

  it('should detect Writing status as active', () => {
    expect(matchesActivePattern('Writing to file...\n')).toBe(true);
  });

  it('should detect tool use patterns (Bash) as active', () => {
    expect(matchesActivePattern('output\nBash command running\n')).toBe(true);
  });

  it('should detect tool use patterns (Grep) as active', () => {
    expect(matchesActivePattern('output\nGrep searching...\n')).toBe(true);
  });

  it('should detect tool use patterns (Edit) as active', () => {
    expect(matchesActivePattern('Applying Edit to file.ts\n')).toBe(true);
  });

  it('should detect tool use patterns (Task) as active', () => {
    expect(matchesActivePattern('Launching Task agent\n')).toBe(true);
  });

  it('should return false for idle prompt', () => {
    expect(matchesActivePattern('What would you like me to do?\n> \n')).toBe(false);
  });

  it('should return false for empty output', () => {
    expect(matchesActivePattern('')).toBe(false);
  });

  it('should return false for whitespace-only output', () => {
    expect(matchesActivePattern('   \n  \n')).toBe(false);
  });

  it('should return false for generic text without status indicators', () => {
    expect(matchesActivePattern('Hello, how can I help?\n')).toBe(false);
  });

  it('should be case-insensitive for status words', () => {
    expect(matchesActivePattern('COMPUTING something\n')).toBe(true);
    expect(matchesActivePattern('thinking deeply\n')).toBe(true);
  });
});

describe('PAN-154: Lazy Pattern with Active Status Filtering', () => {
  // These patterns are the lazy indicators from deacon.ts
  const LAZY_PATTERNS = [
    /what would you like me to do\??/i,
    /option\s*[123]:/i,
    /options?:/i,
    /would you prefer/i,
    /should I (continue|proceed|stop)/i,
    /this would take \d+[-–]\d+ hours/i,
    /estimated \d+ hours/i,
    /manual intervention/i,
    /requires human/i,
    /stop here/i,
    /deferred (to|for) (future|later|follow-up)/i,
    /future PR/i,
    /follow-up issue/i,
    /documented for later/i,
    /remaining work documented/i,
    /targeted approach/i,
    /infrastructure.*(complete|done).*tests.*(fail|broken)/i,
  ];

  const ACTIVE_STATUS_PATTERNS = [
    /computing/i,
    /fermenting/i,
    /thinking/i,
    /reading/i,
    /writing/i,
    /editing/i,
    /searching/i,
    /running/i,
    /executing/i,
    /tool use/i,
    /\bBash\b/,
    /\bRead\b/,
    /\bWrite\b/,
    /\bEdit\b/,
    /\bGrep\b/,
    /\bGlob\b/,
    /\bTask\b/,
  ];

  function isActiveOutput(output: string): boolean {
    for (const pattern of ACTIVE_STATUS_PATTERNS) {
      if (pattern.test(output)) return true;
    }
    return false;
  }

  function hasLazyPattern(output: string): boolean {
    for (const pattern of LAZY_PATTERNS) {
      if (pattern.test(output)) return true;
    }
    return false;
  }

  it('should NOT flag as lazy when output contains Computing + lazy pattern', () => {
    const output = 'What would you like me to do?\nComputing…\n> \n';
    // Active check runs first — if active, skip lazy check
    expect(isActiveOutput(output)).toBe(true);
  });

  it('should NOT flag as lazy when output contains Thinking + lazy pattern', () => {
    const output = 'Option 1: something\nThinking…\n';
    expect(isActiveOutput(output)).toBe(true);
  });

  it('should flag as lazy when output has lazy patterns but no active indicators', () => {
    const output = 'What would you like me to do?\nOption 1: Do this\nOption 2: Do that\n> \n';
    expect(isActiveOutput(output)).toBe(false);
    expect(hasLazyPattern(output)).toBe(true);
  });

  it('should detect all lazy pattern variants', () => {
    const lazySamples = [
      'What would you like me to do?',
      'Option 1: something',
      'Options:',
      'Would you prefer A or B?',
      'Should I continue?',
      'This would take 5-10 hours',
      'Estimated 3 hours',
      'Manual intervention required',
      'Requires human review',
      'I will stop here',
      'Deferred to future PR',
      'Future PR for this',
      'Follow-up issue needed',
      'Documented for later',
      'Remaining work documented',
      'A targeted approach',
      'Infrastructure complete but tests fail',
    ];

    for (const sample of lazySamples) {
      expect(hasLazyPattern(sample)).toBe(true);
    }
  });
});

describe('PAN-154: Agent State Cleanup Logic', () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-cleanup-logic-'));
    agentsDir = join(tempDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Test the cleanup logic directly without importing the full deacon module
  // This avoids complex mocking of the entire module dependency tree

  function isEligibleForCleanup(
    agentDir: string,
    retentionMs: number,
    hasTmuxSession: boolean
  ): boolean {
    if (hasTmuxSession) return false;

    const stateFile = join(agentDir, 'state.json');
    let mtime: number;

    if (existsSync(stateFile)) {
      const { statSync } = require('fs');
      mtime = statSync(stateFile).mtimeMs;
    } else {
      const { statSync } = require('fs');
      mtime = statSync(agentDir).mtimeMs;
    }

    const ageMs = Date.now() - mtime;
    if (ageMs < retentionMs) return false;

    const completedFile = join(agentDir, 'completed');
    if (existsSync(completedFile)) {
      const { statSync } = require('fs');
      const completedAge = Date.now() - statSync(completedFile).mtimeMs;
      if (completedAge < 7 * 24 * 60 * 60 * 1000) return false;
    }

    return true;
  }

  it('should mark old dirs without tmux as eligible for cleanup', () => {
    const agentDir = join(agentsDir, 'agent-pan-old');
    mkdirSync(agentDir);
    const stateFile = join(agentDir, 'state.json');
    writeFileSync(stateFile, '{}');

    // Set mtime to 40 days ago
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(stateFile, oldTime, oldTime);

    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(isEligibleForCleanup(agentDir, retentionMs, false)).toBe(true);
  });

  it('should NOT mark recent dirs as eligible for cleanup', () => {
    const agentDir = join(agentsDir, 'agent-pan-recent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), '{}');

    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(isEligibleForCleanup(agentDir, retentionMs, false)).toBe(false);
  });

  it('should NOT mark dirs with active tmux as eligible', () => {
    const agentDir = join(agentsDir, 'agent-pan-active');
    mkdirSync(agentDir);
    const stateFile = join(agentDir, 'state.json');
    writeFileSync(stateFile, '{}');

    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(stateFile, oldTime, oldTime);

    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(isEligibleForCleanup(agentDir, retentionMs, true)).toBe(false);
  });

  it('should NOT mark dirs with recent completion markers', () => {
    const agentDir = join(agentsDir, 'agent-pan-completed');
    mkdirSync(agentDir);
    const stateFile = join(agentDir, 'state.json');
    writeFileSync(stateFile, '{}');

    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(stateFile, oldTime, oldTime);

    // Create recent completed marker
    writeFileSync(join(agentDir, 'completed'), 'processed');

    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(isEligibleForCleanup(agentDir, retentionMs, false)).toBe(false);
  });

  it('should use dir mtime when state.json is missing', () => {
    const agentDir = join(agentsDir, 'agent-pan-nostate');
    mkdirSync(agentDir);
    // No state.json — directory is very recent

    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(isEligibleForCleanup(agentDir, retentionMs, false)).toBe(false);
  });
});

describe('PAN-154: Retention Config', () => {
  it('should have correct default retention values', async () => {
    // Defaults tightened post-refactor: event-driven cleanup (runParallelReview
    // Phase 6, postMergeLifecycle, executeCloseOut) deletes state at the event
    // that renders it obsolete, so retention is a safety net rather than the
    // primary mechanism. See docs/REVIEW-AGENT-ARCHITECTURE.md.
    const { DEFAULT_CLOISTER_CONFIG } = await import('../../../src/lib/cloister/config.js');

    expect(DEFAULT_CLOISTER_CONFIG.retention).toBeDefined();
    // Work/planning agent state: 7-day safety net (post-completion debugging window)
    expect(DEFAULT_CLOISTER_CONFIG.retention!.agent_state_days).toBe(7);
    // Reviewer state: 1-day safety net (pure ephemeral; Phase 6 deletes on happy path)
    expect(DEFAULT_CLOISTER_CONFIG.retention!.reviewer_state_days).toBe(1);
    expect(DEFAULT_CLOISTER_CONFIG.retention!.health_staleness_hours).toBe(24);
  });
});

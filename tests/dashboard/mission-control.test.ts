/**
 * Tests for Mission Control activity aggregation & planning artifacts (PAN-163).
 *
 * Verifies that Mission Control correctly renders all activity section types
 * (PLANNING, WORK, REVIEW, TEST, MERGE) and handles planning artifacts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildAgentSections,
  buildSpecialistSections,
  sortSections,
  readPlanningArtifacts,
  uploadPlanningArtifact,
  initPlanningDirectory,
  determineStateLabel,
  determineFeatureStatus,
  type ActivitySection,
} from '../../src/dashboard/lib/mission-control.js';

let testDir: string;
let agentsDir: string;
let specialistsDir: string;
let planningDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'mc-test-'));
  agentsDir = join(testDir, 'agents');
  specialistsDir = join(testDir, 'specialists');
  planningDir = join(testDir, 'planning');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(specialistsDir, { recursive: true });
  mkdirSync(planningDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createAgentState(agentId: string, state: Record<string, unknown>): void {
  const dir = join(agentsDir, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

function createSpecialistLog(
  projectKey: string,
  specialistType: string,
  filename: string,
  content: string,
): void {
  const runsDir = join(specialistsDir, projectKey, specialistType, 'runs');
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, filename), content);
}

// ── buildAgentSections ───────────────────────────────────────────────────────

describe('buildAgentSections', () => {
  it('should return empty array when no agent directories exist', () => {
    const sections = buildAgentSections(agentsDir, 'pan-99');
    expect(sections).toEqual([]);
  });

  it('should return planning section for planning agent', () => {
    createAgentState('planning-pan-10', {
      model: 'claude-opus-4-6',
      startedAt: '2026-02-08T10:00:00Z',
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('planning');
    expect(sections[0].sessionId).toBe('planning-pan-10');
    expect(sections[0].model).toBe('claude-opus-4-6');
    expect(sections[0].status).toBe('running');
  });

  it('should return work section for work agent', () => {
    createAgentState('agent-pan-10', {
      model: 'claude-sonnet-4-5-20250929',
      startedAt: '2026-02-08T11:00:00Z',
      state: 'suspended',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('work');
    expect(sections[0].sessionId).toBe('agent-pan-10');
    expect(sections[0].model).toBe('claude-sonnet-4-5-20250929');
    expect(sections[0].status).toBe('completed');
  });

  it('should return both planning and work sections when both exist', () => {
    createAgentState('planning-pan-10', {
      model: 'claude-opus-4-6',
      startedAt: '2026-02-08T09:00:00Z',
      state: 'completed',
    });
    createAgentState('agent-pan-10', {
      model: 'claude-sonnet-4-5-20250929',
      startedAt: '2026-02-08T10:00:00Z',
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toHaveLength(2);
    expect(sections[0].type).toBe('planning');
    expect(sections[1].type).toBe('work');
  });

  it('should handle agent with missing startedAt gracefully', () => {
    createAgentState('agent-pan-10', {
      model: 'claude-opus-4-6',
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toHaveLength(1);
    expect(sections[0].duration).toBeNull();
    expect(sections[0].startedAt).toBeTruthy(); // Falls back to new Date().toISOString()
  });

  it('should skip agents with malformed state.json', () => {
    const dir = join(agentsDir, 'agent-pan-10');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), 'not valid json{{{');

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toEqual([]);
  });

  it('should skip agents without state.json file', () => {
    mkdirSync(join(agentsDir, 'agent-pan-10'), { recursive: true });
    // No state.json created

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections).toEqual([]);
  });

  it('should use runtime field as fallback for model', () => {
    createAgentState('agent-pan-10', {
      runtime: 'kimi-k2',
      startedAt: '2026-02-08T10:00:00Z',
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].model).toBe('kimi-k2');
  });

  it('should default model to unknown when both model and runtime are missing', () => {
    createAgentState('agent-pan-10', {
      startedAt: '2026-02-08T10:00:00Z',
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].model).toBe('unknown');
  });

  it('should calculate duration in seconds from startedAt', () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    createAgentState('agent-pan-10', {
      model: 'test',
      startedAt,
      state: 'active',
    });

    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].duration).toBeGreaterThanOrEqual(119);
    expect(sections[0].duration).toBeLessThan(125);
  });

  it('should map state "active" to status "running"', () => {
    createAgentState('agent-pan-10', { state: 'active', startedAt: new Date().toISOString() });
    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].status).toBe('running');
  });

  it('should map state "suspended" to status "completed"', () => {
    createAgentState('agent-pan-10', { state: 'suspended', startedAt: new Date().toISOString() });
    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].status).toBe('completed');
  });

  it('should use status field as fallback when state is neither active nor suspended', () => {
    createAgentState('agent-pan-10', { state: 'idle', status: 'failed', startedAt: new Date().toISOString() });
    const sections = buildAgentSections(agentsDir, 'pan-10');
    expect(sections[0].status).toBe('failed');
  });
});

// ── buildSpecialistSections ──────────────────────────────────────────────────

describe('buildSpecialistSections', () => {
  it('should return empty array when specialists dir does not exist', () => {
    const sections = buildSpecialistSections('/nonexistent', 'pan-10', ['panopticon']);
    expect(sections).toEqual([]);
  });

  it('should return empty array when no matching run logs exist', () => {
    createSpecialistLog('panopticon', 'review-agent', 'unrelated-issue.log', 'some content');
    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toEqual([]);
  });

  it('should parse review agent run log correctly', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-2026-02-08.log', [
      'Started: 2026-02-08T14:00:00Z',
      'Status: passed',
      'Finished: 2026-02-08T14:05:00Z',
      '',
      'Review output here...',
    ].join('\n'));

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('review');
    expect(sections[0].startedAt).toBe('2026-02-08T14:00:00Z');
    expect(sections[0].status).toBe('completed');
    expect(sections[0].duration).toBe(300); // 5 minutes
    expect(sections[0].model).toBe('specialist');
  });

  it('should parse test agent run log correctly', () => {
    createSpecialistLog('panopticon', 'test-agent', 'pan-10-run-1.log', [
      'Started: 2026-02-08T15:00:00Z',
      'Status: failed',
      'Finished: 2026-02-08T15:02:00Z',
      '',
      'Test failures: 3',
    ].join('\n'));

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('test');
    expect(sections[0].status).toBe('failed');
    expect(sections[0].duration).toBe(120);
  });

  it('should parse merge agent run log correctly', () => {
    createSpecialistLog('panopticon', 'merge-agent', 'pan-10-merge.log', [
      'Started: 2026-02-08T16:00:00Z',
      'Status: completed',
      'Finished: 2026-02-08T16:01:00Z',
      '',
      'Merge successful',
    ].join('\n'));

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('merge');
    expect(sections[0].status).toBe('completed');
  });

  it('should return all section types when multiple specialist logs exist', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');
    createSpecialistLog('panopticon', 'test-agent', 'pan-10-test.log',
      'Started: 2026-02-08T15:00:00Z\nStatus: passed\nFinished: 2026-02-08T15:03:00Z');
    createSpecialistLog('panopticon', 'merge-agent', 'pan-10-merge.log',
      'Started: 2026-02-08T16:00:00Z\nStatus: completed\nFinished: 2026-02-08T16:01:00Z');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(3);

    const types = sections.map(s => s.type);
    expect(types).toContain('review');
    expect(types).toContain('test');
    expect(types).toContain('merge');
  });

  it('should limit to 3 most recent runs per specialist type', () => {
    for (let i = 1; i <= 5; i++) {
      createSpecialistLog('panopticon', 'review-agent', `pan-10-run-${i}.log`,
        `Started: 2026-02-08T1${i}:00:00Z\nStatus: passed\nFinished: 2026-02-08T1${i}:05:00Z`);
    }

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(3);
  });

  it('should search across multiple project keys', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');
    createSpecialistLog('pan', 'test-agent', 'pan-10-test.log',
      'Started: 2026-02-08T15:00:00Z\nStatus: passed\nFinished: 2026-02-08T15:03:00Z');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon', 'pan']);
    expect(sections).toHaveLength(2);
  });

  it('should handle run log without Finished timestamp', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: running\n\nStill in progress...');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
    expect(sections[0].duration).toBeNull();
  });

  it('should handle run log without Status line', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nFinished: 2026-02-08T14:05:00Z\n\nNo status line');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
    expect(sections[0].status).toBe('completed'); // Default
  });

  it('should include full log content as transcript', () => {
    const logContent = 'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z\n\nDetailed review output...';
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log', logContent);

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections[0].transcript).toBe(logContent);
  });

  it('should only match files containing the exact issue ID', () => {
    // PAN-1 should NOT match PAN-10
    createSpecialistLog('panopticon', 'review-agent', 'pan-1-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    // "pan-1" IS contained in "pan-10" (substring match) - this is actually a known bug!
    // The current implementation uses .includes() which has this issue.
    // This test documents the current behavior.
    expect(sections).toHaveLength(0); // pan-1 does not include "pan-10"
  });

  it('should match when issue ID appears anywhere in filename', () => {
    createSpecialistLog('panopticon', 'review-agent', '2026-02-08-pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');

    const sections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    expect(sections).toHaveLength(1);
  });
});

// ── sortSections ─────────────────────────────────────────────────────────────

describe('sortSections', () => {
  it('should sort sections by startedAt ascending', () => {
    const sections: ActivitySection[] = [
      { type: 'work', sessionId: '2', model: 'test', startedAt: '2026-02-08T12:00:00Z', duration: null, status: 'completed', transcript: '' },
      { type: 'planning', sessionId: '1', model: 'test', startedAt: '2026-02-08T10:00:00Z', duration: null, status: 'completed', transcript: '' },
      { type: 'review', sessionId: '3', model: 'test', startedAt: '2026-02-08T14:00:00Z', duration: null, status: 'completed', transcript: '' },
    ];

    const sorted = sortSections(sections);
    expect(sorted.map(s => s.type)).toEqual(['planning', 'work', 'review']);
  });

  it('should push sections without startedAt to the end', () => {
    const sections: ActivitySection[] = [
      { type: 'work', sessionId: '2', model: 'test', startedAt: '', duration: null, status: 'completed', transcript: '' },
      { type: 'planning', sessionId: '1', model: 'test', startedAt: '2026-02-08T10:00:00Z', duration: null, status: 'completed', transcript: '' },
    ];

    const sorted = sortSections(sections);
    expect(sorted[0].type).toBe('planning');
    expect(sorted[1].type).toBe('work');
  });

  it('should not mutate original array', () => {
    const sections: ActivitySection[] = [
      { type: 'work', sessionId: '2', model: 'test', startedAt: '2026-02-08T12:00:00Z', duration: null, status: 'completed', transcript: '' },
      { type: 'planning', sessionId: '1', model: 'test', startedAt: '2026-02-08T10:00:00Z', duration: null, status: 'completed', transcript: '' },
    ];

    sortSections(sections);
    expect(sections[0].type).toBe('work'); // Original unchanged
  });

  it('should handle empty array', () => {
    expect(sortSections([])).toEqual([]);
  });
});

// ── readPlanningArtifacts ────────────────────────────────────────────────────

describe('readPlanningArtifacts', () => {
  it('should return empty result when planning dir does not exist', () => {
    const result = readPlanningArtifacts('/nonexistent/planning');
    expect(result.prd).toBeUndefined();
    expect(result.state).toBeUndefined();
    expect(result.inference).toBeUndefined();
    expect(result.transcripts).toEqual([]);
    expect(result.discussions).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it('should read PRD.md', () => {
    writeFileSync(join(planningDir, 'PRD.md'), '# Product Requirements');
    const result = readPlanningArtifacts(planningDir);
    expect(result.prd).toBe('# Product Requirements');
  });

  it('should read STATE.md', () => {
    writeFileSync(join(planningDir, 'STATE.md'), '# Current State');
    const result = readPlanningArtifacts(planningDir);
    expect(result.state).toBe('# Current State');
  });

  it('should read INFERENCE.md for shadow engineering', () => {
    writeFileSync(join(planningDir, 'INFERENCE.md'), '# Inference Doc');
    const result = readPlanningArtifacts(planningDir);
    expect(result.inference).toBe('# Inference Doc');
  });

  it('should fall back to PLANNING_PROMPT.md when PRD.md is missing', () => {
    writeFileSync(join(planningDir, 'PLANNING_PROMPT.md'), '# Planning Prompt');
    const result = readPlanningArtifacts(planningDir);
    expect(result.prd).toBe('# Planning Prompt');
  });

  it('should prefer PRD.md over PLANNING_PROMPT.md', () => {
    writeFileSync(join(planningDir, 'PRD.md'), '# Actual PRD');
    writeFileSync(join(planningDir, 'PLANNING_PROMPT.md'), '# Planning Prompt');
    const result = readPlanningArtifacts(planningDir);
    expect(result.prd).toBe('# Actual PRD');
  });

  it('should read transcripts from subdirectory', () => {
    const transDir = join(planningDir, 'transcripts');
    mkdirSync(transDir, { recursive: true });
    writeFileSync(join(transDir, 'kickoff.md'), '# Kickoff Meeting');

    const result = readPlanningArtifacts(planningDir);
    expect(result.transcripts).toHaveLength(1);
    expect(result.transcripts[0].filename).toBe('kickoff.md');
    expect(result.transcripts[0].content).toBe('# Kickoff Meeting');
    expect(result.transcripts[0].uploadedAt).toBeTruthy();
  });

  it('should read discussions from subdirectory', () => {
    const discDir = join(planningDir, 'discussions');
    mkdirSync(discDir, { recursive: true });
    writeFileSync(join(discDir, 'github-PAN-10-comments.md'), '# GitHub Discussion');

    const result = readPlanningArtifacts(planningDir);
    expect(result.discussions).toHaveLength(1);
    expect(result.discussions[0].filename).toBe('github-PAN-10-comments.md');
  });

  it('should read notes from subdirectory', () => {
    const notesDir = join(planningDir, 'notes');
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(join(notesDir, 'architecture.md'), '# Architecture Notes');

    const result = readPlanningArtifacts(planningDir);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].filename).toBe('architecture.md');
  });

  it('should filter to only .md and .txt files in subdirectories', () => {
    const transDir = join(planningDir, 'transcripts');
    mkdirSync(transDir, { recursive: true });
    writeFileSync(join(transDir, 'valid.md'), 'content');
    writeFileSync(join(transDir, 'also-valid.txt'), 'content');
    writeFileSync(join(transDir, 'invalid.json'), '{}');
    writeFileSync(join(transDir, 'invalid.pdf'), 'pdf');

    const result = readPlanningArtifacts(planningDir);
    expect(result.transcripts).toHaveLength(2);
  });

  it('should sort subdirectory artifacts by modification time (newest first)', () => {
    const transDir = join(planningDir, 'transcripts');
    mkdirSync(transDir, { recursive: true });

    // Create files with slightly different times
    writeFileSync(join(transDir, 'older.md'), 'older content');

    // Force a slightly later mtime by writing after a small delay
    const newerPath = join(transDir, 'newer.md');
    writeFileSync(newerPath, 'newer content');
    // Touch the file to ensure it has a later mtime
    const futureTime = new Date(Date.now() + 1000);
    const { utimesSync } = require('fs');
    utimesSync(newerPath, futureTime, futureTime);

    const result = readPlanningArtifacts(planningDir);
    expect(result.transcripts[0].filename).toBe('newer.md');
    expect(result.transcripts[1].filename).toBe('older.md');
  });
});

// ── uploadPlanningArtifact ───────────────────────────────────────────────────

describe('uploadPlanningArtifact', () => {
  it('should upload a transcript to the transcripts subdirectory', () => {
    const result = uploadPlanningArtifact(planningDir, 'transcript', 'kickoff.md', '# Kickoff');
    expect(result.success).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, 'utf-8')).toBe('# Kickoff');
    expect(result.path).toContain('transcripts');
  });

  it('should upload a note to the notes subdirectory', () => {
    const result = uploadPlanningArtifact(planningDir, 'note', 'arch.md', '# Architecture');
    expect(result.success).toBe(true);
    expect(result.path).toContain('notes');
  });

  it('should sanitize unsafe characters in filename', () => {
    const result = uploadPlanningArtifact(planningDir, 'transcript', 'my file (1)!.md', 'content');
    expect(result.success).toBe(true);
    expect(result.path).not.toContain(' ');
    expect(result.path).not.toContain('(');
    expect(result.path).not.toContain(')');
    expect(result.path).not.toContain('!');
  });

  it('should add .md extension when filename has no recognized extension', () => {
    const result = uploadPlanningArtifact(planningDir, 'transcript', 'notes', 'content');
    expect(result.path).toMatch(/\.md$/);
  });

  it('should not add extra extension when filename already ends with .md', () => {
    const result = uploadPlanningArtifact(planningDir, 'transcript', 'notes.md', 'content');
    expect(result.path).not.toMatch(/\.md\.md$/);
  });

  it('should not add extra extension when filename already ends with .txt', () => {
    const result = uploadPlanningArtifact(planningDir, 'transcript', 'notes.txt', 'content');
    expect(result.path).not.toMatch(/\.txt\.md$/);
  });

  it('should create subdirectory if it does not exist', () => {
    const freshDir = join(testDir, 'fresh-planning');
    // Don't create the directory - uploadPlanningArtifact should create it
    const result = uploadPlanningArtifact(freshDir, 'transcript', 'test.md', 'content');
    expect(result.success).toBe(true);
    expect(existsSync(result.path)).toBe(true);
  });
});

// ── initPlanningDirectory ────────────────────────────────────────────────────

describe('initPlanningDirectory', () => {
  it('should create all required subdirectories', () => {
    const dir = join(testDir, 'new-planning');
    initPlanningDirectory(dir, 'PAN-10');

    expect(existsSync(join(dir, 'transcripts'))).toBe(true);
    expect(existsSync(join(dir, 'discussions'))).toBe(true);
    expect(existsSync(join(dir, 'notes'))).toBe(true);
  });

  it('should not create INFERENCE.md by default', () => {
    const dir = join(testDir, 'new-planning');
    initPlanningDirectory(dir, 'PAN-10');
    expect(existsSync(join(dir, 'INFERENCE.md'))).toBe(false);
  });

  it('should create INFERENCE.md when shadow is true', () => {
    const dir = join(testDir, 'shadow-planning');
    initPlanningDirectory(dir, 'PAN-10', true);

    expect(existsSync(join(dir, 'INFERENCE.md'))).toBe(true);
    const content = readFileSync(join(dir, 'INFERENCE.md'), 'utf-8');
    expect(content).toContain('PAN-10');
    expect(content).toContain('Shadow Engineering');
    expect(content).toContain('Awaiting initial artifact analysis');
  });

  it('should not overwrite existing INFERENCE.md', () => {
    const dir = join(testDir, 'existing-shadow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'INFERENCE.md'), 'Custom content');

    initPlanningDirectory(dir, 'PAN-10', true);
    expect(readFileSync(join(dir, 'INFERENCE.md'), 'utf-8')).toBe('Custom content');
  });

  it('should be idempotent (safe to call multiple times)', () => {
    const dir = join(testDir, 'idempotent');
    initPlanningDirectory(dir, 'PAN-10');
    initPlanningDirectory(dir, 'PAN-10'); // Call again
    expect(existsSync(join(dir, 'transcripts'))).toBe(true);
  });
});

// ── determineStateLabel ──────────────────────────────────────────────────────

describe('determineStateLabel', () => {
  const defaults = {
    hasTmux: false,
    reviewStatus: null as string | null,
    testStatus: null as string | null,
    agentStatus: null as string | null,
    hasRecentAgentActivity: false,
    hasPrd: false,
    hasState: false,
  };

  it('should return "In Progress" when tmux session exists', () => {
    expect(determineStateLabel({ ...defaults, hasTmux: true })).toBe('In Progress');
  });

  it('should return "Done" when review and test both passed', () => {
    expect(determineStateLabel({
      ...defaults, reviewStatus: 'passed', testStatus: 'passed',
    })).toBe('Done');
  });

  it('should return "In Review" when review is pending', () => {
    expect(determineStateLabel({ ...defaults, reviewStatus: 'pending' })).toBe('In Review');
  });

  it('should return "In Review" when review is reviewing', () => {
    expect(determineStateLabel({ ...defaults, reviewStatus: 'reviewing' })).toBe('In Review');
  });

  it('should return "Suspended" when agent is suspended', () => {
    expect(determineStateLabel({ ...defaults, agentStatus: 'suspended' })).toBe('Suspended');
  });

  it('should return "In Progress" for active agent with recent activity', () => {
    expect(determineStateLabel({
      ...defaults, agentStatus: 'active', hasRecentAgentActivity: true,
    })).toBe('In Progress');
  });

  it('should return "Planning" when PRD exists but no STATE', () => {
    expect(determineStateLabel({ ...defaults, hasPrd: true })).toBe('Planning');
  });

  it('should return "Has Context" when STATE exists', () => {
    expect(determineStateLabel({ ...defaults, hasState: true })).toBe('Has Context');
  });

  it('should return "Idle" as default', () => {
    expect(determineStateLabel(defaults)).toBe('Idle');
  });

  it('should prioritize tmux over everything else', () => {
    expect(determineStateLabel({
      ...defaults,
      hasTmux: true,
      reviewStatus: 'passed',
      testStatus: 'passed',
    })).toBe('In Progress');
  });

  it('should prioritize Done over In Review', () => {
    expect(determineStateLabel({
      ...defaults,
      reviewStatus: 'passed',
      testStatus: 'passed',
    })).toBe('Done');
  });
});

// ── determineFeatureStatus ───────────────────────────────────────────────────

describe('determineFeatureStatus', () => {
  it('should return "running" for active agent with recent activity', () => {
    expect(determineFeatureStatus({
      agentStatus: 'active',
      hasRecentAgentActivity: true,
      hasTmux: false,
      hasState: false,
    })).toBe('running');
  });

  it('should return "running" for agent with tmux session (non-idle)', () => {
    expect(determineFeatureStatus({
      agentStatus: 'active',
      hasRecentAgentActivity: false,
      hasTmux: true,
      hasState: false,
    })).toBe('running');
  });

  it('should return "has_state" when state exists and not running', () => {
    expect(determineFeatureStatus({
      agentStatus: null,
      hasRecentAgentActivity: false,
      hasTmux: false,
      hasState: true,
    })).toBe('has_state');
  });

  it('should return "idle" as default', () => {
    expect(determineFeatureStatus({
      agentStatus: null,
      hasRecentAgentActivity: false,
      hasTmux: false,
      hasState: false,
    })).toBe('idle');
  });

  it('should not return "running" for idle agent with tmux', () => {
    expect(determineFeatureStatus({
      agentStatus: 'idle',
      hasRecentAgentActivity: false,
      hasTmux: true,
      hasState: false,
    })).not.toBe('running');
  });
});

// ── Full Pipeline Integration ────────────────────────────────────────────────

describe('Full activity pipeline', () => {
  it('should aggregate and sort all section types in chronological order', () => {
    // Create a planning agent (earliest)
    createAgentState('planning-pan-10', {
      model: 'claude-opus-4-6',
      startedAt: '2026-02-08T09:00:00Z',
      state: 'completed',
    });

    // Create a work agent (second)
    createAgentState('agent-pan-10', {
      model: 'claude-sonnet-4-5-20250929',
      startedAt: '2026-02-08T10:00:00Z',
      state: 'suspended',
    });

    // Create specialist runs (later)
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');
    createSpecialistLog('panopticon', 'test-agent', 'pan-10-test.log',
      'Started: 2026-02-08T15:00:00Z\nStatus: passed\nFinished: 2026-02-08T15:03:00Z');
    createSpecialistLog('panopticon', 'merge-agent', 'pan-10-merge.log',
      'Started: 2026-02-08T16:00:00Z\nStatus: completed\nFinished: 2026-02-08T16:01:00Z');

    // Aggregate all sections
    const agentSections = buildAgentSections(agentsDir, 'pan-10');
    const specialistSections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    const allSections = sortSections([...agentSections, ...specialistSections]);

    // Verify all 5 section types are present
    expect(allSections).toHaveLength(5);
    const types = allSections.map(s => s.type);
    expect(types).toEqual(['planning', 'work', 'review', 'test', 'merge']);
  });

  it('should handle features with only work sections (no specialists yet)', () => {
    createAgentState('agent-pan-10', {
      model: 'claude-sonnet-4-5-20250929',
      startedAt: '2026-02-08T10:00:00Z',
      state: 'active',
    });

    const agentSections = buildAgentSections(agentsDir, 'pan-10');
    const specialistSections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    const allSections = sortSections([...agentSections, ...specialistSections]);

    expect(allSections).toHaveLength(1);
    expect(allSections[0].type).toBe('work');
    expect(allSections[0].status).toBe('running');
  });

  it('should handle features with only specialist sections (agent cleaned up)', () => {
    createSpecialistLog('panopticon', 'review-agent', 'pan-10-review.log',
      'Started: 2026-02-08T14:00:00Z\nStatus: passed\nFinished: 2026-02-08T14:05:00Z');

    const agentSections = buildAgentSections(agentsDir, 'pan-10');
    const specialistSections = buildSpecialistSections(specialistsDir, 'pan-10', ['panopticon']);
    const allSections = sortSections([...agentSections, ...specialistSections]);

    expect(allSections).toHaveLength(1);
    expect(allSections[0].type).toBe('review');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { encodeCwdToProjectDir, findLastCompactBoundarySync, truncateToCompactBoundarySync } from '../specialists.js';

// Mock database module - must use vi.hoisted() to avoid hoisting issues
const { mockUpsertBoundaryRotated, mockGetBoundaryRotated } = vi.hoisted(() => ({
  mockUpsertBoundaryRotated: vi.fn(),
  mockGetBoundaryRotated: vi.fn(),
}));

vi.mock('../database.js', () => ({
  upsertBoundaryRotated: mockUpsertBoundaryRotated,
  getBoundaryRotated: mockGetBoundaryRotated,
}));

// Import rotateSessionCompactionIfNeeded after database mock is set up
const { rotateSessionCompactionIfNeeded } = await import('../specialists.js');

function makeCompactEntry(type: 'boundary' | 'summary'): string {
  if (type === 'boundary') {
    return JSON.stringify({ type: 'system', subtype: 'compact_boundary' }) + '\n';
  }
  return JSON.stringify({ type: 'user', isCompactSummary: true, content: 'Summary of conversation' }) + '\n';
}

describe('rotateSessionCompactionIfNeeded', () => {
  let TEST_DIR: string;

  beforeEach(() => {
    TEST_DIR = join(tmpdir(), `rotate-compaction-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(TEST_DIR, { recursive: true });
    mockGetBoundaryRotated.mockReturnValue(null);
    mockUpsertBoundaryRotated.mockClear();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('skips rotation when specialistType is test-agent (file untouched)', () => {
    const jsonlPath = join(TEST_DIR, 'test-session.jsonl');
    const content = makeCompactEntry('boundary') + makeCompactEntry('summary') + makeNormalEntry('assistant', 'old response');
    writeFileSync(jsonlPath, content);

    rotateSessionCompactionIfNeeded('test-agent', jsonlPath, 'test-session');

    // File must be completely unchanged — test-agent is excluded from rotation
    expect(readFileSync(jsonlPath, 'utf-8')).toBe(content);
    // upsertBoundaryRotated must NOT be called
    expect(mockUpsertBoundaryRotated).not.toHaveBeenCalled();
  });

  it('truncates file for non-test-agent specialists when boundary exists', () => {
    const jsonlPath = join(TEST_DIR, 'review-session.jsonl');
    const beforeBoundary = makeNormalEntry('user', 'old request');
    const boundaryLine = makeCompactEntry('boundary');
    const summaryLine = makeCompactEntry('summary');
    const afterBoundary = makeNormalEntry('assistant', 'old response');
    writeFileSync(jsonlPath, beforeBoundary + boundaryLine + summaryLine + afterBoundary);

    rotateSessionCompactionIfNeeded('review-agent', jsonlPath, 'review-session');

    // File should be truncated to just boundary + summary
    expect(readFileSync(jsonlPath, 'utf-8')).toBe(boundaryLine + summaryLine);
    expect(mockUpsertBoundaryRotated).toHaveBeenCalled();
  });

  it('does nothing when jsonlPath does not exist', () => {
    const jsonlPath = join(TEST_DIR, 'nonexistent-session.jsonl');

    // Should not throw
    rotateSessionCompactionIfNeeded('merge-agent', jsonlPath, 'nonexistent-session');

    expect(mockUpsertBoundaryRotated).not.toHaveBeenCalled();
  });

  it('skips when previousOffset >= boundaryOffset (already rotated)', () => {
    const jsonlPath = join(TEST_DIR, 'already-rotated.jsonl');
    const beforeBoundary = makeNormalEntry('user', 'old');
    const boundaryLine = makeCompactEntry('boundary');
    const summaryLine = makeCompactEntry('summary');
    const afterBoundary = makeNormalEntry('assistant', 'after');
    writeFileSync(jsonlPath, beforeBoundary + boundaryLine + summaryLine + afterBoundary);

    // Simulate previously rotated at offset 100 (past our boundary offset)
    mockGetBoundaryRotated.mockReturnValueOnce(100);

    rotateSessionCompactionIfNeeded('review-agent', jsonlPath, 'already-rotated');

    // File should be unchanged because we already rotated past this boundary
    expect(readFileSync(jsonlPath, 'utf-8')).toBe(beforeBoundary + boundaryLine + summaryLine + afterBoundary);
    expect(mockUpsertBoundaryRotated).not.toHaveBeenCalled();
  });
});

function makeNormalEntry(role: 'user' | 'assistant', content: string): string {
  return JSON.stringify({ type: role, content }) + '\n';
}

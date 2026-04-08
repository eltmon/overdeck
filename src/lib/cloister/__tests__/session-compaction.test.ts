import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { encodeCwdToProjectDir, findLastCompactBoundarySync, truncateToCompactBoundarySync } from '../specialists.js';

// Mock database module for SQLite helper tests - must use vi.hoisted() to avoid hoisting issues
const { mockUpsertBoundaryRotated, mockGetBoundaryRotated } = vi.hoisted(() => ({
  mockUpsertBoundaryRotated: vi.fn(),
  mockGetBoundaryRotated: vi.fn(),
}));

vi.mock('../database.js', () => ({
  upsertBoundaryRotated: mockUpsertBoundaryRotated,
  getBoundaryRotated: mockGetBoundaryRotated,
}));

let TEST_DIR: string;

function makeCompactEntry(type: 'boundary' | 'summary'): string {
  if (type === 'boundary') {
    return JSON.stringify({ type: 'system', subtype: 'compact_boundary' }) + '\n';
  }
  return JSON.stringify({ type: 'user', isCompactSummary: true, content: 'Summary of conversation' }) + '\n';
}

function makeNormalEntry(role: 'user' | 'assistant', content: string): string {
  return JSON.stringify({ type: role, content }) + '\n';
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `session-compaction-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

beforeEach(() => {
  mockUpsertBoundaryRotated.mockClear();
  mockGetBoundaryRotated.mockClear();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('encodeCwdToProjectDir', () => {
  it('replaces slashes with hyphens', () => {
    expect(encodeCwdToProjectDir('/home/user/Projects/foo')).toBe('-home-user-Projects-foo');
  });

  it('handles root slash', () => {
    expect(encodeCwdToProjectDir('/')).toBe('-');
  });

  it('preserves other characters', () => {
    expect(encodeCwdToProjectDir('/home/user/my-project')).toBe('-home-user-my-project');
  });
});

describe('findLastCompactBoundarySync', () => {
  it('returns 0 when file does not exist', () => {
    const result = findLastCompactBoundarySync(join(TEST_DIR, 'nonexistent.jsonl'));
    expect(result).toBe(0);
  });

  it('returns 0 when no boundary exists', () => {
    const file = join(TEST_DIR, 'no-boundary.jsonl');
    writeFileSync(file, makeNormalEntry('user', 'hello') + makeNormalEntry('assistant', 'hi'));
    const result = findLastCompactBoundarySync(file);
    expect(result).toBe(0);
  });

  it('returns byte offset of boundary when it exists', () => {
    const file = join(TEST_DIR, 'with-boundary.jsonl');
    const beforeBoundary = makeNormalEntry('user', 'hello');
    const boundaryLine = makeCompactEntry('boundary');
    writeFileSync(file, beforeBoundary + boundaryLine + makeNormalEntry('assistant', 'after'));

    const offset = findLastCompactBoundarySync(file);
    expect(offset).toBeGreaterThan(0);

    // Verify the offset points to the boundary line
    const content = readFileSync(file, 'utf-8');
    const atOffset = content.slice(offset, offset + boundaryLine.trim().length);
    expect(atOffset).toContain('compact_boundary');
  });

  it('returns offset of last boundary when multiple exist', () => {
    const file = join(TEST_DIR, 'multiple-boundaries.jsonl');
    const firstBoundary = makeCompactEntry('boundary');
    const secondBoundary = makeCompactEntry('boundary');
    writeFileSync(file, firstBoundary + secondBoundary + makeNormalEntry('assistant', 'after'));

    const offset = findLastCompactBoundarySync(file);
    expect(offset).toBe(Buffer.byteLength(firstBoundary, 'utf-8'));
  });
});

describe('truncateToCompactBoundarySync', () => {
  it('returns 0 when no boundary exists', () => {
    const file = join(TEST_DIR, 'no-boundary.jsonl');
    writeFileSync(file, makeNormalEntry('user', 'hello') + makeNormalEntry('assistant', 'hi'));
    const result = truncateToCompactBoundarySync(file);
    expect(result).toBe(0);
    expect(readFileSync(file, 'utf-8')).toBe(makeNormalEntry('user', 'hello') + makeNormalEntry('assistant', 'hi'));
  });

  it('truncates to boundary + isCompactSummary when both exist', () => {
    const file = join(TEST_DIR, 'with-boundary.jsonl');
    const beforeBoundary = makeNormalEntry('user', 'old message');
    const boundaryLine = makeCompactEntry('boundary');
    const summaryLine = makeCompactEntry('summary');
    const afterSummary = makeNormalEntry('assistant', 'new response');

    writeFileSync(file, beforeBoundary + boundaryLine + summaryLine + afterSummary);

    const result = truncateToCompactBoundarySync(file);
    expect(result).toBeGreaterThan(0);

    const remaining = readFileSync(file, 'utf-8');
    expect(remaining).toBe(boundaryLine + summaryLine);
    expect(remaining).not.toContain('old message');
    expect(remaining).not.toContain('new response');
  });

  it('returns 0 when boundary exists but no isCompactSummary follows', () => {
    const file = join(TEST_DIR, 'boundary-no-summary.jsonl');
    const beforeBoundary = makeNormalEntry('user', 'old message');
    const boundaryLine = makeCompactEntry('boundary');
    const afterBoundary = makeNormalEntry('assistant', 'response after boundary');

    writeFileSync(file, beforeBoundary + boundaryLine + afterBoundary);

    const result = truncateToCompactBoundarySync(file);
    expect(result).toBe(0);

    // File should be unchanged
    const remaining = readFileSync(file, 'utf-8');
    expect(remaining).toBe(beforeBoundary + boundaryLine + afterBoundary);
  });

  it('is idempotent — re-running finds no un-rotated boundary', () => {
    const file = join(TEST_DIR, 'idempotent.jsonl');
    const boundaryLine = makeCompactEntry('boundary');
    const summaryLine = makeCompactEntry('summary');

    writeFileSync(file, makeNormalEntry('user', 'old') + boundaryLine + summaryLine);

    const first = truncateToCompactBoundarySync(file);
    expect(first).toBeGreaterThan(0);

    const second = truncateToCompactBoundarySync(file);
    expect(second).toBe(0); // No further boundary found in already-truncated file

    // File still has exactly 2 lines
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('handles multiple boundaries — truncates to last one', () => {
    const file = join(TEST_DIR, 'multiple-boundaries.jsonl');
    const firstBoundary = makeCompactEntry('boundary');
    const firstSummary = makeCompactEntry('summary');
    const middleContent = makeNormalEntry('user', 'middle');
    const secondBoundary = makeCompactEntry('boundary');
    const secondSummary = makeCompactEntry('summary');
    const afterSecond = makeNormalEntry('assistant', 'after second');

    writeFileSync(file, firstBoundary + firstSummary + middleContent + secondBoundary + secondSummary + afterSecond);

    const result = truncateToCompactBoundarySync(file);
    expect(result).toBeGreaterThan(0);

    const remaining = readFileSync(file, 'utf-8');
    expect(remaining).toBe(secondBoundary + secondSummary);
    expect(remaining).not.toContain('middle');
    expect(remaining).not.toContain('after second');
  });
});

describe('session_compact_offsets helpers', () => {
  it('getBoundaryRotated returns null for unrotated sessions', async () => {
    mockGetBoundaryRotated.mockReturnValueOnce(null);

    const { getBoundaryRotated } = await import('../database.js');
    const result = getBoundaryRotated('test-session-id');

    expect(mockGetBoundaryRotated).toHaveBeenCalledWith('test-session-id');
  });

  it('getBoundaryRotated returns offset for previously rotated sessions', async () => {
    mockGetBoundaryRotated.mockReturnValueOnce(1234);

    const { getBoundaryRotated } = await import('../database.js');
    const result = getBoundaryRotated('test-session-id');

    expect(result).toBe(1234);
    expect(mockGetBoundaryRotated).toHaveBeenCalledWith('test-session-id');
  });

  it('upsertBoundaryRotated can be called with sessionId and offset', async () => {
    const { upsertBoundaryRotated } = await import('../database.js');
    upsertBoundaryRotated('session-abc', 500);
    expect(mockUpsertBoundaryRotated).toHaveBeenCalledWith('session-abc', 500);
  });
});

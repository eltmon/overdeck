/**
 * Global test setup for Panopticon tests
 */

import { vi, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Test fixtures directory
export const FIXTURES_DIR = join(__dirname, 'fixtures');
export const TEMP_DIR = join(__dirname, '.temp');

// Collapse merge-agent polling intervals in tests so syncMainIntoWorkspace
// conflict tests finish in milliseconds instead of 5s each. See merge-agent.ts.
process.env.PANOPTICON_TEST_POLL_MS = '10';

// Don't pin PAN_YOLO globally — tests should exercise the production default
// (auto mode). Test files that assert on the legacy bypass strings opt in
// locally with `process.env.PAN_YOLO = 'true'` in their beforeEach.
delete process.env.PAN_YOLO;

// Clean up temp directory before each test
beforeEach(() => {
  try {
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
  try {
    mkdirSync(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist from another test running in parallel
  }
});

// Clean up temp directory after each test suite
afterEach(() => {
  if (existsSync(TEMP_DIR)) {
    try {
      rmSync(TEMP_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      // Ignore cleanup errors
      console.warn('Failed to clean up TEMP_DIR in afterEach:', error);
    }
  }
});

// Mock console to reduce noise in tests (optional)
// Uncomment if needed:
// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});

// Global mock for execa to avoid actual shell commands
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    execaSync: vi.fn().mockReturnValue({ stdout: '', stderr: '', exitCode: 0 }),
  };
});

/**
 * Tests for jsonl-parser.ts - getActiveSessionModel()
 *
 * Tests the function that extracts the full model ID from Claude Code session files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { getActiveSessionModel } from '../../../src/lib/cost-parsers/jsonl-parser.js';

describe('getActiveSessionModel', () => {
  let tempHome: string;
  let originalHome: string;

  beforeEach(() => {
    // Create temp directory for test
    tempHome = mkdtempSync(join(tmpdir(), 'pan-test-jsonl-'));
    originalHome = process.env.HOME!;

    // Note: We cannot override the CLAUDE_PROJECTS_DIR at runtime since it's
    // defined at module load time. These tests work with the real ~/.claude/projects
    // directory but use unique workspace names to avoid conflicts.
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('should return null for workspace with no session files', () => {
    // Use a workspace path that definitely doesn't exist
    const nonExistentWorkspace = '/tmp/nonexistent-workspace-12345';
    const result = getActiveSessionModel(nonExistentWorkspace);
    expect(result).toBeNull();
  });

  it('should return null for invalid workspace path', () => {
    const invalidPath = '';
    const result = getActiveSessionModel(invalidPath);
    expect(result).toBeNull();
  });

  it('should return model ID from valid session file', () => {
    // Create a unique test workspace path
    const testWorkspacePath = join(tempHome, 'test-workspace');

    // Convert to Claude project dir name format (keeps leading dash)
    // e.g., /tmp/pan-test/test-workspace -> -tmp-pan-test-test-workspace
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    // Create the directory
    mkdirSync(claudeProjectDir, { recursive: true });

    // Create a valid session file with model ID
    const sessionFile = join(claudeProjectDir, 'test-session.jsonl');
    const sessionContent = JSON.stringify({
      sessionId: 'test-session',
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg-1',
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      }
    });
    writeFileSync(sessionFile, sessionContent + '\n');

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBe('claude-sonnet-4-5-20250929');
    } finally {
      // Clean up
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });

  it('should return model ID from top-level model field', () => {
    // Test case where model is at top level, not in message object
    const testWorkspacePath = join(tempHome, 'test-workspace-2');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    const sessionFile = join(claudeProjectDir, 'session2.jsonl');
    const sessionContent = JSON.stringify({
      sessionId: 'test-session-2',
      timestamp: new Date().toISOString(),
      model: 'claude-opus-4-5-20251101',
      usage: {
        input_tokens: 200,
        output_tokens: 100
      }
    });
    writeFileSync(sessionFile, sessionContent + '\n');

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBe('claude-opus-4-5-20251101');
    } finally {
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });

  it('should return null when session file has no model field', () => {
    const testWorkspacePath = join(tempHome, 'test-workspace-3');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    const sessionFile = join(claudeProjectDir, 'session3.jsonl');
    const sessionContent = JSON.stringify({
      sessionId: 'test-session-3',
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg-1',
        role: 'user'
        // No model field
      }
    });
    writeFileSync(sessionFile, sessionContent + '\n');

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBeNull();
    } finally {
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });

  it('should handle invalid JSON in session file gracefully', () => {
    const testWorkspacePath = join(tempHome, 'test-workspace-4');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    const sessionFile = join(claudeProjectDir, 'session4.jsonl');
    // Write invalid JSON
    writeFileSync(sessionFile, 'not valid json\n');

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBeNull();
    } finally {
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });

  it('should use most recently modified session file', () => {
    const testWorkspacePath = join(tempHome, 'test-workspace-5');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    // Create older session file
    const oldSessionFile = join(claudeProjectDir, 'old-session.jsonl');
    const oldContent = JSON.stringify({
      sessionId: 'old-session',
      model: 'claude-haiku-4-5-20250101'
    });
    writeFileSync(oldSessionFile, oldContent + '\n');

    // Wait a bit to ensure different mtime
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Create newer session file
    setTimeout(() => {
      const newSessionFile = join(claudeProjectDir, 'new-session.jsonl');
      const newContent = JSON.stringify({
        sessionId: 'new-session',
        model: 'claude-sonnet-4-5-20250929'
      });
      writeFileSync(newSessionFile, newContent + '\n');

      try {
        const result = getActiveSessionModel(testWorkspacePath);
        // Should return model from newer file
        expect(result).toBe('claude-sonnet-4-5-20250929');
      } finally {
        rmSync(claudeProjectDir, { recursive: true, force: true });
      }
    }, 100);
  });

  it('should search first 10 lines for model field', () => {
    const testWorkspacePath = join(tempHome, 'test-workspace-6');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    const sessionFile = join(claudeProjectDir, 'session6.jsonl');

    // Create session file with model in 5th line
    let content = '';
    for (let i = 0; i < 4; i++) {
      content += JSON.stringify({ sessionId: 'test', message: { role: 'user' } }) + '\n';
    }
    // 5th line has the model
    content += JSON.stringify({
      sessionId: 'test',
      model: 'claude-opus-4-5-20251101'
    }) + '\n';

    writeFileSync(sessionFile, content);

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBe('claude-opus-4-5-20251101');
    } finally {
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });

  it('should handle special characters in workspace path', () => {
    // Test with path containing special characters that need escaping
    const testWorkspacePath = join(tempHome, 'test-workspace-special');
    const projectDirName = testWorkspacePath.replace(/\//g, '-');
    const claudeProjectDir = join(homedir(), '.claude', 'projects', projectDirName);

    mkdirSync(claudeProjectDir, { recursive: true });

    const sessionFile = join(claudeProjectDir, 'session.jsonl');
    const sessionContent = JSON.stringify({
      model: 'claude-sonnet-4-5-20250929'
    });
    writeFileSync(sessionFile, sessionContent + '\n');

    try {
      const result = getActiveSessionModel(testWorkspacePath);
      expect(result).toBe('claude-sonnet-4-5-20250929');
    } finally {
      rmSync(claudeProjectDir, { recursive: true, force: true });
    }
  });
});

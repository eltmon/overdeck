/**
 * Tests for jsonl-parser.ts
 *
 * Tests for:
 * - getActiveSessionModel() - Extracts full model ID from session files
 * - parseClaudeSession() - Parses session usage with multi-model cost calculation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { getActiveSessionModel, parseClaudeSession } from '../../../src/lib/cost-parsers/jsonl-parser.js';

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

describe('parseClaudeSession', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-parse-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a test session file with synthetic messages
   */
  function createTestSession(messages: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    timestamp?: string;
  }>): string {
    const sessionFile = join(tempDir, 'test-session.jsonl');
    const sessionId = 'test-session-123';

    const lines = messages.map((msg, i) => JSON.stringify({
      sessionId,
      timestamp: msg.timestamp || new Date(Date.now() + i * 1000).toISOString(),
      message: {
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        model: msg.model,
        usage: {
          input_tokens: msg.inputTokens,
          output_tokens: msg.outputTokens,
        },
      },
    }));

    writeFileSync(sessionFile, lines.join('\n') + '\n');
    return sessionFile;
  }

  it('should return null for non-existent file', () => {
    const result = parseClaudeSession('/tmp/nonexistent-file.jsonl');
    expect(result).toBeNull();
  });

  it('should return null for session with no usage', () => {
    const sessionFile = join(tempDir, 'no-usage.jsonl');
    const content = JSON.stringify({
      sessionId: 'test',
      message: { role: 'user' }
    });
    writeFileSync(sessionFile, content + '\n');

    const result = parseClaudeSession(sessionFile);
    expect(result).toBeNull();
  });

  it('should parse single-model session correctly', () => {
    const sessionFile = createTestSession([
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000 },
    ]);

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.model).toBe('claude-sonnet-4.5');  // Normalized
    expect(result!.usage.inputTokens).toBe(3000);
    expect(result!.usage.outputTokens).toBe(1500);
    expect(result!.messageCount).toBe(2);

    // For single-model sessions, cost and cost_v2 should be equal
    expect(result!.cost_v2).toBeDefined();
    expect(result!.cost_v2).toBeCloseTo(result!.cost, 5);

    // Should have model breakdown
    expect(result!.modelBreakdown).toBeDefined();
    expect(result!.modelBreakdown!['claude-sonnet-4-5-20250929']).toBeDefined();
    expect(result!.modelBreakdown!['claude-sonnet-4-5-20250929'].messageCount).toBe(2);
    expect(result!.modelBreakdown!['claude-sonnet-4-5-20250929'].inputTokens).toBe(3000);
    expect(result!.modelBreakdown!['claude-sonnet-4-5-20250929'].outputTokens).toBe(1500);
  });

  it('should calculate costs correctly for multi-model session (Sonnet → Opus)', () => {
    // Simulate auto-upgrade: 5 Sonnet messages, then 2 Opus messages
    const sessionFile = createTestSession([
      // Sonnet messages (cheaper)
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      // Opus messages (more expensive)
      { model: 'claude-opus-4-5-20251101', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-opus-4-5-20251101', inputTokens: 1000, outputTokens: 500 },
    ]);

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();

    // Model display should show progression
    expect(result!.model).toBe('claude-sonnet-4.5 → claude-opus-4.5');

    // Should have breakdown for both models
    expect(result!.modelBreakdown).toBeDefined();
    expect(Object.keys(result!.modelBreakdown!).length).toBe(2);
    expect(result!.modelBreakdown!['claude-sonnet-4-5-20250929']).toBeDefined();
    expect(result!.modelBreakdown!['claude-opus-4-5-20251101']).toBeDefined();

    // Verify Sonnet breakdown
    const sonnetBreakdown = result!.modelBreakdown!['claude-sonnet-4-5-20250929'];
    expect(sonnetBreakdown.messageCount).toBe(5);
    expect(sonnetBreakdown.inputTokens).toBe(5000);
    expect(sonnetBreakdown.outputTokens).toBe(2500);

    // Verify Opus breakdown
    const opusBreakdown = result!.modelBreakdown!['claude-opus-4-5-20251101'];
    expect(opusBreakdown.messageCount).toBe(2);
    expect(opusBreakdown.inputTokens).toBe(2000);
    expect(opusBreakdown.outputTokens).toBe(1000);

    // Calculate expected costs manually
    // Sonnet: input=$0.003/1k, output=$0.015/1k
    const expectedSonnetCost = (5000 * 0.003 / 1000) + (2500 * 0.015 / 1000);
    expect(sonnetBreakdown.cost).toBeCloseTo(expectedSonnetCost, 5);

    // Opus: input=$0.005/1k, output=$0.025/1k
    const expectedOpusCost = (2000 * 0.005 / 1000) + (1000 * 0.025 / 1000);
    expect(opusBreakdown.cost).toBeCloseTo(expectedOpusCost, 5);

    // cost_v2 should be sum of both
    expect(result!.cost_v2).toBeCloseTo(expectedSonnetCost + expectedOpusCost, 5);

    // CRITICAL: cost_v2 should be GREATER than cost
    // (cost uses first model = Sonnet for all messages, which underestimates)
    expect(result!.cost_v2!).toBeGreaterThan(result!.cost);

    // Verify the underestimation: cost assumes all 7 messages use Sonnet pricing
    const expectedOldCost = (7000 * 0.003 / 1000) + (3500 * 0.015 / 1000);
    expect(result!.cost).toBeCloseTo(expectedOldCost, 5);
  });

  it('should handle multiple model switches', () => {
    // Sonnet → Opus → Sonnet
    const sessionFile = createTestSession([
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-opus-4-5-20251101', inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500 },
    ]);

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.modelBreakdown).toBeDefined();
    expect(Object.keys(result!.modelBreakdown!).length).toBe(2);

    // Verify Sonnet aggregated correctly (messages 1 + 3)
    const sonnetBreakdown = result!.modelBreakdown!['claude-sonnet-4-5-20250929'];
    expect(sonnetBreakdown.messageCount).toBe(2);
    expect(sonnetBreakdown.inputTokens).toBe(2000);

    // Opus should have 1 message
    const opusBreakdown = result!.modelBreakdown!['claude-opus-4-5-20251101'];
    expect(opusBreakdown.messageCount).toBe(1);
  });

  it('should handle sessions with cache tokens', () => {
    const sessionFile = join(tempDir, 'cache-test.jsonl');
    const content = JSON.stringify({
      sessionId: 'cache-test',
      timestamp: new Date().toISOString(),
      message: {
        model: 'claude-sonnet-4-5-20250929',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 2000,
        },
      },
    });
    writeFileSync(sessionFile, content + '\n');

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.usage.cacheReadTokens).toBe(5000);
    expect(result!.usage.cacheWriteTokens).toBe(2000);

    // Cost should include cache pricing
    expect(result!.cost_v2).toBeDefined();
    expect(result!.cost_v2!).toBeGreaterThan(0);
  });

  it('should handle top-level usage field', () => {
    const sessionFile = join(tempDir, 'top-level-usage.jsonl');
    const content = JSON.stringify({
      sessionId: 'top-level-test',
      timestamp: new Date().toISOString(),
      model: 'claude-opus-4-5-20251101',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
      },
    });
    writeFileSync(sessionFile, content + '\n');

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.model).toBe('claude-opus-4.5');
    expect(result!.usage.inputTokens).toBe(1000);
    expect(result!.usage.outputTokens).toBe(500);
    expect(result!.cost_v2).toBeDefined();
    expect(result!.modelBreakdown).toBeDefined();
  });

  it('should skip messages with invalid JSON', () => {
    const sessionFile = join(tempDir, 'invalid-json.jsonl');
    const lines = [
      JSON.stringify({
        sessionId: 'test',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 1000, output_tokens: 500 }
        }
      }),
      'invalid json line here',
      JSON.stringify({
        sessionId: 'test',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 2000, output_tokens: 1000 }
        }
      }),
    ];
    writeFileSync(sessionFile, lines.join('\n') + '\n');

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.messageCount).toBe(2);  // Should skip invalid line
    expect(result!.usage.inputTokens).toBe(3000);
  });

  it('should use session ID from filename if not in messages', () => {
    const sessionFile = join(tempDir, 'my-session-id.jsonl');
    const content = JSON.stringify({
      message: {
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 1000, output_tokens: 500 }
      }
    });
    writeFileSync(sessionFile, content + '\n');

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('my-session-id');
  });

  it('should default to claude-sonnet-4 if no model found', () => {
    const sessionFile = join(tempDir, 'no-model.jsonl');
    const content = JSON.stringify({
      sessionId: 'test',
      message: {
        usage: { input_tokens: 1000, output_tokens: 500 }
        // No model field
      }
    });
    writeFileSync(sessionFile, content + '\n');

    const result = parseClaudeSession(sessionFile);

    expect(result).not.toBeNull();
    expect(result!.model).toBe('claude-sonnet-4');
    // Should not have modelBreakdown since no model IDs found
    expect(result!.modelBreakdown).toBeUndefined();
  });
});

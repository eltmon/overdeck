import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { forkSession } from '../../../../src/lib/conversations/fork-session.js';
import { sessionFilePath } from '../../../../src/lib/paths.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tmpHome() {
  return join(tmpdir(), `fork-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const SIMPLE_LINE = JSON.stringify({ type: 'prompt', message: 'hello' });
const THINKING_LINE = JSON.stringify({
  type: 'assistant',
  message: {
    content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'answer' }],
  },
});
const BOUNDARY_LINE = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
const AFTER_BOUNDARY_LINE = JSON.stringify({ type: 'prompt', message: 'after boundary' });

describe('forkSession', () => {
  let TEST_HOME: string;
  let ORIGINAL_HOME: string | undefined;

  beforeEach(() => {
    ORIGINAL_HOME = process.env.HOME;
    TEST_HOME = tmpHome();
    process.env.HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    if (ORIGINAL_HOME !== undefined) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  function writeSource(cwd: string, sessionId: string, content: string): string {
    const file = sessionFilePath(cwd, sessionId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf-8');
    return file;
  }

  describe('AC1 — creates new session ID and copies JSONL without touching source', () => {
    it('generates a UUID session ID when destSessionId is omitted', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000001';
      const srcContent = SIMPLE_LINE + '\n';
      writeSource(cwd, srcId, srcContent);

      const { sessionId, sessionFile } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
      });

      expect(sessionId).toMatch(UUID_RE);
      expect(sessionFile).toContain(sessionId);
      expect(existsSync(sessionFile)).toBe(true);
    });

    it('uses the provided destSessionId when given', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000002';
      const destId = '11111111-1111-4111-8111-111111111111';
      writeSource(cwd, srcId, SIMPLE_LINE + '\n');

      const { sessionId, sessionFile } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
        destSessionId: destId,
      });

      expect(sessionId).toBe(destId);
      expect(sessionFile).toBe(sessionFilePath(cwd, destId));
    });

    it('leaves source JSONL untouched', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000003';
      const srcContent = SIMPLE_LINE + '\n' + THINKING_LINE + '\n';
      writeSource(cwd, srcId, srcContent);

      await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
      });

      expect(readFileSync(sessionFilePath(cwd, srcId), 'utf-8')).toBe(srcContent);
    });
  });

  describe('AC2 — fullHistory option controls what is copied', () => {
    it('fullHistory:false copies only from last compact_boundary', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000004';
      const srcContent = [
        SIMPLE_LINE,       // before boundary — should be excluded
        BOUNDARY_LINE,
        AFTER_BOUNDARY_LINE,
        '',                // trailing newline
      ].join('\n');
      writeSource(cwd, srcId, srcContent);

      const { sessionFile } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
        fullHistory: false,
      });

      const dest = readFileSync(sessionFile, 'utf-8');
      expect(dest).not.toContain('"hello"');      // pre-boundary content excluded
      expect(dest).toContain('compact_boundary'); // boundary included
      expect(dest).toContain('after boundary');   // post-boundary content included
    });

    it('fullHistory:true copies the entire source including pre-boundary content', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000005';
      const srcContent = [
        SIMPLE_LINE,
        BOUNDARY_LINE,
        AFTER_BOUNDARY_LINE,
        '',
      ].join('\n');
      writeSource(cwd, srcId, srcContent);

      const { sessionFile } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
        fullHistory: true,
      });

      const dest = readFileSync(sessionFile, 'utf-8');
      expect(dest).toContain('"hello"');          // pre-boundary content included
      expect(dest).toContain('compact_boundary');
      expect(dest).toContain('after boundary');
    });

    it('sanitizes thinking blocks to plain text in both modes', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000006';
      const srcContent = THINKING_LINE + '\n';
      writeSource(cwd, srcId, srcContent);

      const { sessionFile: sfFull } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
        fullHistory: true,
      });
      const destFull = readFileSync(sfFull, 'utf-8');
      expect(destFull).not.toContain('"thinking"');
      expect(destFull).toContain('[Thinking]');

      const srcId2 = '00000000-0000-4000-8000-000000000007';
      writeSource(cwd, srcId2, srcContent);
      const { sessionFile: sfBoundary } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId2),
        destCwd: cwd,
        fullHistory: false,
      });
      const destBoundary = readFileSync(sfBoundary, 'utf-8');
      expect(destBoundary).not.toContain('"thinking"');
      expect(destBoundary).toContain('[Thinking]');
    });
  });

  describe('AC3 — session is designed for --resume', () => {
    it('returned sessionId is a valid UUID suitable for --resume flag', async () => {
      const cwd = join(TEST_HOME, 'proj');
      const srcId = '00000000-0000-4000-8000-000000000008';
      writeSource(cwd, srcId, SIMPLE_LINE + '\n');

      const { sessionId } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
      });

      expect(sessionId).toMatch(UUID_RE);
    });

    it('sessionFile path follows Claude Code session storage convention', async () => {
      const cwd = join(TEST_HOME, 'my-project');
      const srcId = '00000000-0000-4000-8000-000000000009';
      writeSource(cwd, srcId, SIMPLE_LINE + '\n');

      const { sessionId, sessionFile } = await forkSession({
        sourceSessionFile: sessionFilePath(cwd, srcId),
        destCwd: cwd,
      });

      expect(sessionFile).toBe(sessionFilePath(cwd, sessionId));
      expect(sessionFile).toContain('.claude');
      expect(sessionFile).toContain('projects');
      expect(sessionFile.endsWith(`${sessionId}.jsonl`)).toBe(true);
    });
  });
});

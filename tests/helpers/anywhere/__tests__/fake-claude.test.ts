/** PAN-4774 WI-2: the fake `claude` writes a Claude-shaped transcript and logs its input. */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeClaude } from '../fake-claude.js';

let home: string;
let child: ChildProcess | null = null;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'odk-fake-claude-')));
});

afterEach(() => {
  child?.kill('SIGKILL');
  child = null;
  rmSync(home, { recursive: true, force: true });
});

function readLines(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('installFakeClaude (PAN-4774 WI-2)', () => {
  it('ac3: --version prints the Claude Code banner and exits 0', () => {
    const { binDir } = installFakeClaude(home, process.execPath);
    expect(execFileSync(join(binDir, 'claude'), ['--version'], { encoding: 'utf8' }).trim()).toBe('2.1.0 (Claude Code)');
  });

  it('ac1+ac2: a --session-id run prompts, logs stdin and appends a fake reply to its JSONL', async () => {
    const { binDir, inputLog } = installFakeClaude(home, process.execPath);
    const cwd = join(home, 'work dir');
    mkdirSync(cwd);
    const id = randomUUID();
    let stdout = '';
    child = spawn(join(binDir, 'claude'), ['--model', 'x', '--session-id', id], { cwd, env: { PATH: process.env['PATH'], HOME: home } });
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    await vi.waitFor(() => expect(stdout).toContain('❯'), { timeout: 10_000, interval: 50 });

    child.stdin!.write('\u001b[200~hello\u001b[201~\r\n');
    const jsonl = join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), `${id}.jsonl`);
    await vi.waitFor(() => expect(readLines(jsonl)).toHaveLength(4), { timeout: 10_000, interval: 50 });

    const lines = readLines(jsonl);
    const last = lines[3]!;
    expect(last).toMatchObject({ type: 'assistant', sessionId: id, cwd });
    expect(JSON.stringify(last['message'])).toContain('fake-reply:hello');
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(['cwd', 'message', 'sessionId', 'timestamp', 'type', 'uuid']);
      expect(JSON.stringify(line)).not.toContain('"model"');
    }
    expect(readFileSync(inputLog, 'utf8')).toBe('hello\n');
    expect(child.exitCode).toBeNull();
  });
});

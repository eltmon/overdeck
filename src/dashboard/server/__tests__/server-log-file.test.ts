import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dashboardLogPath, stdoutAlreadyTargetsLog, teeStreamToFile } from '../server-log-file.js';

let TEST_HOME: string;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-1552-log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(() => {
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('dashboardLogPath', () => {
  it('resolves under PANOPTICON_HOME/logs', () => {
    expect(dashboardLogPath()).toBe(join(TEST_HOME, 'logs', 'dashboard.log'));
  });
});

describe('stdoutAlreadyTargetsLog', () => {
  it('returns false for a path that is not the process stdout (the tee-and-create case)', () => {
    // A path that does not exist must not be mistaken for the current stdout.
    expect(stdoutAlreadyTargetsLog(join(TEST_HOME, 'logs', 'dashboard.log'))).toBe(false);
  });
});

describe('teeStreamToFile', () => {
  it('mirrors writes to the file while preserving passthrough and return value', async () => {
    mkdirSync(join(TEST_HOME, 'logs'), { recursive: true });
    const logPath = join(TEST_HOME, 'logs', 'dashboard.log');
    const fileStream = createWriteStream(logPath, { flags: 'a' });

    const passthrough: string[] = [];
    const fakeStdout = {
      write(chunk: unknown): boolean {
        passthrough.push(String(chunk));
        return true;
      },
    };

    teeStreamToFile(fakeStdout, fileStream);

    const ret = fakeStdout.write('[conversations] send message failed: boom\n');

    // Original write still ran (terminal output unchanged) and its value passed through.
    expect(ret).toBe(true);
    expect(passthrough).toEqual(['[conversations] send message failed: boom\n']);

    await new Promise<void>((resolve) => fileStream.end(resolve));

    const contents = readFileSync(logPath, 'utf-8');
    expect(contents).toContain('[conversations] send message failed: boom');
  });

  it('does not throw if the log-file write fails', () => {
    const fakeStdout = {
      write(): boolean {
        return true;
      },
    };
    const brokenFile = {
      write() {
        throw new Error('disk full');
      },
    } as unknown as ReturnType<typeof createWriteStream>;

    teeStreamToFile(fakeStdout, brokenFile);

    // The real stream must still succeed even though the log copy throws.
    expect(() => fakeStdout.write('hello')).not.toThrow();
  });
});

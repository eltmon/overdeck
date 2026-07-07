import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureMnemos, MnemosInstallError } from '../mnemos.js';

let tempDir: string | null = null;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pan-mnemos-installer-'));
});

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function bytesResponse(value: Buffer): Response {
  return {
    ok: true,
    arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  } as Response;
}

function textResponse(value: string): Response {
  return {
    ok: true,
    text: async () => value,
  } as Response;
}

function release(binaryName = 'mnemos-linux-amd64.tar.gz') {
  return {
    assets: [
      { name: binaryName, browser_download_url: 'https://example.test/mnemos' },
      { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums.txt' },
    ],
  };
}

describe('ensureMnemos', () => {
  it('downloads the matching release asset, verifies checksum, and writes an executable binary', async () => {
    const binary = Buffer.from('mnemos binary');
    const checksum = createHash('sha256').update(binary).digest('hex');
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/releases/latest')) return jsonResponse(release());
      if (text.endsWith('/mnemos')) return bytesResponse(binary);
      if (text.endsWith('/checksums.txt')) return textResponse(`${checksum}  mnemos-linux-amd64.tar.gz\n`);
      throw new Error(`unexpected fetch ${text}`);
    });
    const runCommand = vi.fn(async () => {});
    const binPath = join(tempDir!, 'home', 'bin', 'mnemos');

    const result = await ensureMnemos({ binPath, fetchImpl, runCommand, platform: 'linux', arch: 'x64' });

    expect(result).toEqual({ status: 'installed', path: binPath });
    expect(await readFile(binPath)).toEqual(binary);
    expect((await stat(binPath)).mode & 0o111).not.toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('uses an existing working binary and performs no download', async () => {
    const binPath = join(tempDir!, 'bin', 'mnemos');
    await mkdir(join(tempDir!, 'bin'), { recursive: true });
    await writeFile(binPath, 'existing', { mode: 0o755 });
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should not run for an existing working binary');
    });
    const runCommand = vi.fn(async () => {});

    const result = await ensureMnemos({ binPath, fetchImpl, runCommand });

    expect(result).toEqual({ status: 'already-installed', path: binPath });
    expect(runCommand).toHaveBeenCalledWith(binPath, ['--version']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs first-use ingest when a bundle path is supplied', async () => {
    const binPath = join(tempDir!, 'bin', 'mnemos');
    await mkdir(join(tempDir!, 'bin'), { recursive: true });
    await writeFile(binPath, 'existing', { mode: 0o755 });
    const runCommand = vi.fn(async () => {});

    await ensureMnemos({ binPath, bundlePath: '/tmp/bundle', runCommand });

    expect(runCommand.mock.calls).toEqual([
      [binPath, ['--version']],
      [binPath, ['ingest', '/tmp/bundle']],
    ]);
  });

  it('rejects checksum mismatches and leaves no partial binary behind', async () => {
    const binary = Buffer.from('mnemos binary');
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/releases/latest')) return jsonResponse(release());
      if (text.endsWith('/mnemos')) return bytesResponse(binary);
      if (text.endsWith('/checksums.txt')) return textResponse(`${'0'.repeat(64)}  mnemos-linux-amd64.tar.gz\n`);
      throw new Error(`unexpected fetch ${text}`);
    });
    const binPath = join(tempDir!, 'bin', 'mnemos');

    await expect(ensureMnemos({ binPath, fetchImpl, platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(MnemosInstallError);
    await expect(stat(binPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

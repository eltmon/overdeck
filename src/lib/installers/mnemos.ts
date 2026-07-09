import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getOverdeckHome } from '../paths.js';

const MNEMOS_REPO_API = 'https://api.github.com/repos/arhuman/mnemos/releases/latest';

export interface EnsureMnemosOptions {
  binPath?: string;
  bundlePath?: string;
  fetchImpl?: typeof fetch;
  runCommand?: CommandRunner;
  extractArchive?: ExtractArchiveFn;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
}

export interface EnsureMnemosResult {
  status: 'already-installed' | 'installed';
  path: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<void>;
export type ExtractArchiveFn = (archivePath: string, extractDir: string) => Promise<void>;

interface GithubRelease {
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

interface ReleaseAsset {
  name: string;
  url: string;
}

export class MnemosInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MnemosInstallError';
  }
}

export async function ensureMnemos(options: EnsureMnemosOptions = {}): Promise<EnsureMnemosResult> {
  const binPath = options.binPath ?? join(getOverdeckHome(), 'bin', 'mnemos');
  const runCommand = options.runCommand ?? runCommandWithSpawn;

  if (await existingBinaryWorks(binPath, runCommand)) {
    if (options.bundlePath) await runCommand(binPath, ['ingest', options.bundlePath]);
    return { status: 'already-installed', path: binPath };
  }

  await installMnemos({
    binPath,
    fetchImpl: options.fetchImpl ?? fetch,
    extractArchive: options.extractArchive ?? extractArchiveWithSpawn,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
  });
  if (options.bundlePath) await runCommand(binPath, ['ingest', options.bundlePath]);
  return { status: 'installed', path: binPath };
}

async function existingBinaryWorks(binPath: string, runCommand: CommandRunner): Promise<boolean> {
  try {
    await stat(binPath);
    await runCommand(binPath, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function installMnemos(input: {
  binPath: string;
  fetchImpl: typeof fetch;
  extractArchive: ExtractArchiveFn;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}): Promise<void> {
  const release = await fetchJson<GithubRelease>(input.fetchImpl, MNEMOS_REPO_API);
  const assets = normalizeAssets(release);
  const binaryAsset = selectBinaryAsset(assets, input.platform, input.arch);
  const checksumAsset = selectChecksumAsset(assets);
  const [archiveBytes, checksumText] = await Promise.all([
    fetchBytes(input.fetchImpl, binaryAsset.url),
    fetchText(input.fetchImpl, checksumAsset.url),
  ]);

  verifyChecksum(archiveBytes, checksumText, binaryAsset.name);
  await mkdir(dirname(input.binPath), { recursive: true });

  if (!isArchive(binaryAsset.name)) {
    // Release is a raw binary; write it directly.
    const tmpPath = `${input.binPath}.tmp-${process.pid}`;
    try {
      await writeFile(tmpPath, archiveBytes, { mode: 0o755 });
      await chmod(tmpPath, 0o755);
      await rename(tmpPath, input.binPath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return;
  }

  // Release is an archive; extract the binary before installing it.
  const extractDir = await mkdtemp(join(tmpdir(), 'mnemos-extract-'));
  const archivePath = join(extractDir, binaryAsset.name);
  const binaryName = input.platform === 'win32' ? 'mnemos.exe' : 'mnemos';
  const extractedPath = join(extractDir, binaryName);
  const tmpPath = `${input.binPath}.tmp-${process.pid}`;

  try {
    await writeFile(archivePath, archiveBytes);
    await input.extractArchive(archivePath, extractDir);
    await stat(extractedPath);
    await rename(extractedPath, tmpPath);
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, input.binPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new MnemosInstallError(`Failed to fetch ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchBytes(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new MnemosInstallError(`Failed to fetch ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new MnemosInstallError(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function normalizeAssets(release: GithubRelease): ReleaseAsset[] {
  return (release.assets ?? [])
    .filter((asset): asset is { name: string; browser_download_url: string } =>
      typeof asset.name === 'string' && typeof asset.browser_download_url === 'string')
    .map((asset) => ({ name: asset.name, url: asset.browser_download_url }));
}

function selectBinaryAsset(assets: ReleaseAsset[], platform: NodeJS.Platform, arch: NodeJS.Architecture): ReleaseAsset {
  const platformToken = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : 'linux';
  const archToken = arch === 'x64' ? 'amd64' : arch;
  const asset = assets.find((candidate) => {
    const name = candidate.name.toLowerCase();
    return name.includes(platformToken) && name.includes(archToken) && !name.includes('checksum') && !name.includes('sha256');
  });
  if (!asset) throw new MnemosInstallError(`No mnemos release asset for ${platformToken}/${archToken}`);
  return asset;
}

function selectChecksumAsset(assets: ReleaseAsset[]): ReleaseAsset {
  const asset = assets.find((candidate) => {
    const name = candidate.name.toLowerCase();
    return name.includes('checksum') || name.includes('sha256');
  });
  if (!asset) throw new MnemosInstallError('No mnemos checksum asset found');
  return asset;
}

function verifyChecksum(binary: Buffer, checksumText: string, assetName: string): void {
  const actual = createHash('sha256').update(binary).digest('hex');
  const expected = expectedChecksumForAsset(checksumText, assetName);
  if (actual !== expected) {
    throw new MnemosInstallError(`Checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
}

function expectedChecksumForAsset(checksumText: string, assetName: string): string {
  for (const line of checksumText.split('\n')) {
    if (!line.includes(assetName)) continue;
    const match = line.match(/\b[a-fA-F0-9]{64}\b/);
    if (match) return match[0].toLowerCase();
  }
  const fallback = checksumText.match(/\b[a-fA-F0-9]{64}\b/);
  if (fallback) return fallback[0].toLowerCase();
  throw new MnemosInstallError(`No sha256 checksum found for ${assetName}`);
}

function isArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.zip');
}

async function extractArchiveWithSpawn(archivePath: string, extractDir: string): Promise<void> {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await runCommandWithSpawn('tar', ['-xzf', archivePath, '-C', extractDir]);
    return;
  }
  if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await runCommandWithSpawn('powershell', [
        '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}'`,
      ]);
      return;
    }
    await runCommandWithSpawn('unzip', ['-q', archivePath, '-d', extractDir]);
    return;
  }
  throw new MnemosInstallError(`Unsupported archive format: ${archivePath}`);
}

async function runCommandWithSpawn(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new MnemosInstallError(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

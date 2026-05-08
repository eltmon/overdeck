/**
 * cliproxy.ts
 *
 * Local CLIProxyAPI sidecar lifecycle. CLIProxyAPI (router-for-me/CLIProxyAPI)
 * exposes an Anthropic-compatible `/v1/messages` endpoint backed by the
 * OpenAI Responses WebSocket transport using ChatGPT subscription OAuth tokens.
 *
 * Panopticon runs cliproxy as a background sidecar so Claude Code can drive
 * GPT models (via ANTHROPIC_BASE_URL) without needing an OpenAI API key.
 *
 * Responsibilities:
 *   - Download + install the cliproxy binary from GitHub releases
 *   - Maintain `~/.panopticon/cliproxy/config.yaml` + auth-dir
 *   - Bridge `~/.codex/auth.json` into cliproxy's codex credential format
 *   - Start / stop / supervise the process via a pidfile
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { spawn, execSync, exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { PANOPTICON_HOME, BIN_DIR } from './paths.js';

const execAsync = promisify(exec);

export const CLIPROXY_HOST = '127.0.0.1';
export const CLIPROXY_PORT = 8317;
export const CLIPROXY_AUTH_TOKEN = 'panopticon-local-cliproxy-key';
export const CLIPROXY_BASE_URL = `http://${CLIPROXY_HOST}:${CLIPROXY_PORT}`;

const CLIPROXY_RELEASE_VERSION = 'v6.10.9';

export function getCliproxyDir(): string {
  return join(PANOPTICON_HOME, 'cliproxy');
}

export function getCliproxyBinary(): string {
  return join(BIN_DIR, 'cliproxy');
}

export function getCliproxyConfigPath(): string {
  return join(getCliproxyDir(), 'config.yaml');
}

export function getCliproxyAuthDir(): string {
  return join(getCliproxyDir(), 'auth');
}

export function getCliproxyPidPath(): string {
  return join(getCliproxyDir(), 'cliproxy.pid');
}

export function getCliproxyLogPath(): string {
  return join(getCliproxyDir(), 'cliproxy.log');
}

function getCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json');
}

function getCliproxyCodexCredPath(): string {
  return join(getCliproxyAuthDir(), 'codex-primary.json');
}

function getCliproxyGeminiCredPath(): string {
  return join(getCliproxyAuthDir(), 'gemini-primary.json');
}

function ensureDirs(): void {
  for (const dir of [PANOPTICON_HOME, BIN_DIR, getCliproxyDir(), getCliproxyAuthDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

interface CodexAuthFile {
  auth_mode?: unknown;
  last_refresh?: unknown;
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
}

interface CliproxyCodexCredentials {
  access_token: string;
  id_token: string;
  refresh_token: string;
  account_id: string;
  last_refresh: string;
  email: string;
  type: 'codex';
  expired: string;
  disabled: boolean;
}

interface CliproxyGeminiCredentials {
  api_key: string;
  type: 'gemini';
  disabled: boolean;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(normalized + padding, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Read ~/.codex/auth.json and write cliproxy's credential file format into
 * ~/.panopticon/cliproxy/auth/codex-primary.json. Returns true if the file
 * was written (including "already up-to-date" writes), false if the source
 * was missing or malformed.
 */
export function bridgeCodexAuthToCliproxy(): boolean {
  const codexPath = getCodexAuthPath();
  if (!existsSync(codexPath)) return false;

  let raw: CodexAuthFile;
  try {
    raw = JSON.parse(readFileSync(codexPath, 'utf8')) as CodexAuthFile;
  } catch {
    return false;
  }

  const accessToken = typeof raw.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
  const idToken = typeof raw.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
  const refreshToken = typeof raw.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
  const accountId = typeof raw.tokens?.account_id === 'string' ? raw.tokens.account_id : null;
  const lastRefresh = typeof raw.last_refresh === 'string' ? raw.last_refresh : new Date().toISOString();

  if (!accessToken || !idToken || !refreshToken || !accountId) return false;

  const idClaims = decodeJwtPayload(idToken) ?? {};
  const email = typeof idClaims.email === 'string' ? idClaims.email : '';
  const accessClaims = decodeJwtPayload(accessToken) ?? {};
  const expSec = typeof accessClaims.exp === 'number'
    ? accessClaims.exp
    : (typeof idClaims.exp === 'number' ? idClaims.exp : Math.floor(Date.now() / 1000) + 3600);
  const expiredIso = new Date(expSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const creds: CliproxyCodexCredentials = {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired: expiredIso,
    disabled: false,
  };

  ensureDirs();
  const target = getCliproxyCodexCredPath();

  // Skip rewrite if content is byte-identical (avoids touching mtime every status poll).
  const serialized = JSON.stringify(creds, null, 2) + '\n';
  if (existsSync(target)) {
    try {
      const existing = readFileSync(target, 'utf8');
      if (existing === serialized) return true;
    } catch {
      // fall through and overwrite
    }
  }

  writeFileSync(target, serialized, { mode: 0o600 });
  return true;
}

/** Async variant of bridgeCodexAuthToCliproxy — safe for the event loop. */
export async function bridgeCodexAuthToCliproxyAsync(): Promise<boolean> {
  const codexPath = getCodexAuthPath();
  if (!existsSync(codexPath)) return false;

  let raw: string;
  try {
    raw = await readFile(codexPath, 'utf8');
  } catch {
    return false;
  }

  let parsed: CodexAuthFile;
  try {
    parsed = JSON.parse(raw) as CodexAuthFile;
  } catch {
    return false;
  }

  const accessToken = typeof parsed.tokens?.access_token === 'string' ? parsed.tokens.access_token : null;
  const idToken = typeof parsed.tokens?.id_token === 'string' ? parsed.tokens.id_token : null;
  const refreshToken = typeof parsed.tokens?.refresh_token === 'string' ? parsed.tokens.refresh_token : null;
  const accountId = typeof parsed.tokens?.account_id === 'string' ? parsed.tokens.account_id : null;
  const lastRefresh = typeof parsed.last_refresh === 'string' ? parsed.last_refresh : new Date().toISOString();

  if (!accessToken || !idToken || !refreshToken || !accountId) return false;

  const idClaims = decodeJwtPayload(idToken) ?? {};
  const email = typeof idClaims.email === 'string' ? idClaims.email : '';
  const accessClaims = decodeJwtPayload(accessToken) ?? {};
  const expSec = typeof accessClaims.exp === 'number'
    ? accessClaims.exp
    : (typeof idClaims.exp === 'number' ? idClaims.exp : Math.floor(Date.now() / 1000) + 3600);
  const expiredIso = new Date(expSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const creds: CliproxyCodexCredentials = {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired: expiredIso,
    disabled: false,
  };

  ensureDirs();
  const target = getCliproxyCodexCredPath();

  const serialized = JSON.stringify(creds, null, 2) + '\n';
  if (existsSync(target)) {
    try {
      const existing = await readFile(target, 'utf8');
      if (existing === serialized) return true;
    } catch {
      // fall through and overwrite
    }
  }

  try {
    await writeFile(target, serialized, { mode: 0o600 });
  } catch {
    return false;
  }
  return true;
}

function readBridgedGeminiApiKey(): string | null {
  const target = getCliproxyGeminiCredPath();
  if (!existsSync(target)) return null;

  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<CliproxyGeminiCredentials>;
    return typeof parsed.api_key === 'string' && parsed.api_key.trim().length > 0
      ? parsed.api_key.trim()
      : null;
  } catch {
    return null;
  }
}

function serializeYamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Persist a Google Generative Language API key for CLIProxyAPI's Gemini backend.
 *
 * CLIProxyAPI v6.10.x accepts Gemini API keys through the `gemini-api-key`
 * config section. We also keep a small credential marker in auth-dir so future
 * config rewrites can preserve the bridged key without re-reading Panopticon
 * settings.
 */
export function bridgeGeminiAuthToCliproxy(apiKey: string): boolean {
  const normalized = apiKey.trim();
  if (!normalized) return false;

  ensureDirs();
  const creds: CliproxyGeminiCredentials = {
    api_key: normalized,
    type: 'gemini',
    disabled: false,
  };

  const serialized = JSON.stringify(creds, null, 2) + '\n';
  const target = getCliproxyGeminiCredPath();
  if (!existsSync(target) || readFileSync(target, 'utf8') !== serialized) {
    writeFileSync(target, serialized, { mode: 0o600 });
  }

  ensureConfigFile(normalized);
  return true;
}

/** Async variant of bridgeGeminiAuthToCliproxy — safe for the event loop. */
export async function bridgeGeminiAuthToCliproxyAsync(apiKey: string): Promise<boolean> {
  const normalized = apiKey.trim();
  if (!normalized) return false;

  ensureDirs();
  const creds: CliproxyGeminiCredentials = {
    api_key: normalized,
    type: 'gemini',
    disabled: false,
  };
  const serialized = JSON.stringify(creds, null, 2) + '\n';
  const target = getCliproxyGeminiCredPath();

  try {
    if (!existsSync(target) || await readFile(target, 'utf8') !== serialized) {
      await writeFile(target, serialized, { mode: 0o600 });
    }
  } catch {
    return false;
  }

  ensureConfigFile(normalized);
  return true;
}

function ensureConfigFile(geminiApiKey: string | null = readBridgedGeminiApiKey()): void {
  ensureDirs();
  const configPath = getCliproxyConfigPath();
  const authDir = getCliproxyAuthDir();

  // Config is rewritten every time so upgrades can evolve the format safely.
  const lines = [
    `host: "${CLIPROXY_HOST}"`,
    `port: ${CLIPROXY_PORT}`,
    `auth-dir: "${authDir}"`,
    `api-keys:`,
    `  - "${CLIPROXY_AUTH_TOKEN}"`,
  ];

  if (geminiApiKey) {
    lines.push(
      `gemini-api-key:`,
      `  - api-key: ${serializeYamlString(geminiApiKey)}`,
    );
  }

  lines.push(`debug: false`, '');
  const config = lines.join('\n');

  if (existsSync(configPath)) {
    try {
      if (readFileSync(configPath, 'utf8') === config) return;
    } catch {
      // overwrite
    }
  }
  writeFileSync(configPath, config);
}

function detectPlatformAsset(): { archive: string; } | null {
  const platform = process.platform;
  const arch = process.arch;
  const version = CLIPROXY_RELEASE_VERSION.replace(/^v/, '');
  let os: string | null = null;
  let cpu: string | null = null;

  if (platform === 'linux') os = 'linux';
  else if (platform === 'darwin') os = 'darwin';

  if (arch === 'x64') cpu = 'amd64';
  else if (arch === 'arm64') cpu = 'arm64';

  if (!os || !cpu) return null;
  return { archive: `CLIProxyAPI_${version}_${os}_${cpu}.tar.gz` };
}

export function isCliproxyInstalled(): boolean {
  const bin = getCliproxyBinary();
  if (!existsSync(bin)) return false;
  try {
    const st = statSync(bin);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Download + extract the cliproxy binary into ~/.panopticon/bin/cliproxy.
 * Uses curl + tar because that's already a hard dep of pan install. Throws
 * with a clear message on unsupported platforms.
 */
export function installCliproxy(force = false): void {
  ensureDirs();
  if (!force && isCliproxyInstalled()) return;

  const asset = detectPlatformAsset();
  if (!asset) {
    throw new Error(
      `CLIProxyAPI does not publish a prebuilt binary for ${process.platform}/${process.arch}. `
      + `GPT subscription routing is currently supported on linux and darwin (amd64/arm64) only.`,
    );
  }

  const url = `https://github.com/router-for-me/CLIProxyAPI/releases/download/${CLIPROXY_RELEASE_VERSION}/${asset.archive}`;
  const tmpDir = join(getCliproxyDir(), 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const archivePath = join(tmpDir, asset.archive);

  execSync(`curl -sSL -o "${archivePath}" "${url}"`, { stdio: 'pipe' });
  execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'pipe' });

  // Release archives extract a binary named "cli-proxy-api" at the root of the tar
  // (alongside README/LICENSE/config.example.yaml).
  const extracted = join(tmpDir, 'cli-proxy-api');
  if (!existsSync(extracted)) {
    throw new Error(`cliproxy archive did not contain expected cli-proxy-api binary`);
  }

  const target = getCliproxyBinary();
  execSync(`install -m 0755 "${extracted}" "${target}"`, { stdio: 'pipe' });
  try {
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
  } catch { /* non-fatal */ }
}

/**
 * Async variant of installCliproxy — safe for the event loop.
 * Uses execAsync instead of execSync so it won't block the dashboard server.
 */
export async function installCliproxyAsync(force = false): Promise<void> {
  ensureDirs();
  if (!force && isCliproxyInstalled()) return;

  const asset = detectPlatformAsset();
  if (!asset) {
    throw new Error(
      `CLIProxyAPI does not publish a prebuilt binary for ${process.platform}/${process.arch}. `
      + `GPT subscription routing is currently supported on linux and darwin (amd64/arm64) only.`,
    );
  }

  const url = `https://github.com/router-for-me/CLIProxyAPI/releases/download/${CLIPROXY_RELEASE_VERSION}/${asset.archive}`;
  const tmpDir = join(getCliproxyDir(), 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const archivePath = join(tmpDir, asset.archive);

  await execAsync(`curl -sSL -o "${archivePath}" "${url}"`, { timeout: 60_000 });
  await execAsync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { timeout: 10_000 });

  const extracted = join(tmpDir, 'cli-proxy-api');
  if (!existsSync(extracted)) {
    throw new Error(`cliproxy archive did not contain expected cli-proxy-api binary`);
  }

  const target = getCliproxyBinary();
  await execAsync(`install -m 0755 "${extracted}" "${target}"`, { timeout: 10_000 });
  try {
    await execAsync(`rm -rf "${tmpDir}"`, { timeout: 10_000 });
  } catch { /* non-fatal */ }
}

export function readPidFile(): number | null {
  const pidPath = getCliproxyPidPath();
  if (!existsSync(pidPath)) return null;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isCliproxyRunning(): boolean {
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) return true;
  // Fallback: something may be listening on the port without our pidfile.
  // Use bash /dev/tcp instead of lsof — busybox lsof on Alpine ignores -t/-i
  // and returns all processes, making this check both incorrect and dangerous.
  try {
    execSync(`bash -c 'echo >/dev/tcp/127.0.0.1/${CLIPROXY_PORT}'`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 1000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start cliproxy in the background. Idempotent — returns immediately if an
 * instance is already running. Ensures config + auth-dir + codex bridge are
 * up-to-date before spawning.
 */
export function startCliproxy(): void {
  ensureDirs();
  ensureConfigFile();
  // Best-effort bridge; if the user hasn't logged into Codex yet, cliproxy
  // will still start but subscription auth won't be available until they do.
  try { bridgeCodexAuthToCliproxy(); } catch { /* non-fatal */ }

  if (isCliproxyRunning()) return;

  if (!isCliproxyInstalled()) {
    installCliproxy();
  }

  const bin = getCliproxyBinary();
  const config = getCliproxyConfigPath();
  const logPath = getCliproxyLogPath();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openSync } = require('fs') as typeof import('fs');
  const logFd = openSync(logPath, 'a');

  const child = spawn(bin, ['-config', config], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: getCliproxyDir(),
  });

  if (!child.pid) {
    throw new Error('Failed to spawn cliproxy');
  }

  writeFileSync(getCliproxyPidPath(), String(child.pid));
  child.unref();
}

export function stopCliproxy(): void {
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  // Also clear anything else bound to the port (stale / manually-started instances).
  // Use fuser instead of lsof | xargs kill — busybox lsof on Alpine ignores -t/-i
  // and lists ALL processes, which xargs then tries to kill (including PID 1).
  try {
    execSync(`fuser -k -TERM ${CLIPROXY_PORT}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(getCliproxyPidPath())) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { unlinkSync } = require('fs') as typeof import('fs');
      unlinkSync(getCliproxyPidPath());
    }
  } catch { /* ignore */ }
}

/**
 * Env vars to inject into Claude Code (or any Anthropic-compatible client) so
 * that it routes model calls through the local cliproxy sidecar.
 */
export function getCliproxyClientEnv(): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: CLIPROXY_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: CLIPROXY_AUTH_TOKEN,
  };
}

// ─── Async lifecycle (safe for dashboard server — no execSync) ─────────────────

/** Check whether the cliproxy TCP port is accepting connections. */
export async function checkCliproxyPortAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(CLIPROXY_PORT, CLIPROXY_HOST);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Async variant of isCliproxyRunning — safe for the event loop. */
export async function isCliproxyRunningAsync(): Promise<boolean> {
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) return true;
  return checkCliproxyPortAsync();
}

/** Async variant of stopCliproxy — safe for the event loop. */
export async function stopCliproxyAsync(): Promise<void> {
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Fallback: kill any process still holding the port.
  // Use fuser instead of lsof | xargs kill — busybox lsof on Alpine ignores -t/-i
  // and lists ALL processes, which xargs then tries to kill (including PID 1).
  try {
    await execAsync(`fuser -k -TERM ${CLIPROXY_PORT}/tcp 2>/dev/null || true`);
  } catch { /* ignore */ }
  try {
    if (existsSync(getCliproxyPidPath())) {
      const { unlinkSync } = await import('fs');
      unlinkSync(getCliproxyPidPath());
    }
  } catch { /* ignore */ }
}

/** Async variant of startCliproxy — safe for the event loop.
 *  Auto-installs cliproxy if missing (non-blocking download). */
export async function startCliproxyAsync(): Promise<void> {
  ensureDirs();
  ensureConfigFile();
  try { bridgeCodexAuthToCliproxy(); } catch { /* non-fatal */ }

  if (await isCliproxyRunningAsync()) return;

  if (!isCliproxyInstalled()) {
    await installCliproxyAsync();
  }

  const bin = getCliproxyBinary();
  const config = getCliproxyConfigPath();
  const logPath = getCliproxyLogPath();

  const { openSync } = await import('fs');
  const logFd = openSync(logPath, 'a');

  const child = spawn(bin, ['-config', config], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: getCliproxyDir(),
  });

  if (!child.pid) {
    throw new Error('Failed to spawn cliproxy');
  }

  writeFileSync(getCliproxyPidPath(), String(child.pid));
  child.unref();
}

/** Restart cliproxy asynchronously. Safe for the event loop. */
export async function restartCliproxyAsync(): Promise<void> {
  await stopCliproxyAsync();
  await new Promise((r) => setTimeout(r, 500));
  await startCliproxyAsync();
}

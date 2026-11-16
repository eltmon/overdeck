#!/usr/bin/env node
// PAN-4591: post-edit Semgrep scan. Standalone (node:* only; tsdown bundles it to run with no
// node_modules at ~/.overdeck/bin/semgrep-edit-hook.js). Never throws: any failure returns ''.
import { execFile as execFileCb } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, lstat as lstatFs, readFile as readFileFs, readlink as readlinkFs, stat as statFs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFileCb);

const SKIP_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.csv', '.tsv', '.log', '.lock',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.snap', '.map',
]);
const MAX_FILE_SIZE = 1_048_576;
const MAX_FINDINGS = 10;

interface PostToolUseEvent {
  tool_name?: string;
  tool_input?: { file_path?: unknown; [key: string]: unknown };
  cwd?: string;
}

interface SemgrepFinding {
  check_id: string;
  start?: { line?: number };
  extra?: { message?: string; severity?: string };
}

export interface SemgrepEditHookDeps {
  execFile?: (
    file: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string }>;
  readFile?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ isFile(): boolean; size: number }>;
  exists?: (path: string) => Promise<boolean>;
  lstat?: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
  readlink?: (path: string) => Promise<string>;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The env the scan child gets: `base` minus SEMGREP_APP_TOKEN/SEMGREP_RULES, plus quiet + Overdeck-owned state paths. */
export function semgrepScanEnv(base: Record<string, string | undefined>, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.SEMGREP_APP_TOKEN;
  delete env.SEMGREP_RULES;
  const toolsDir = join(home, 'tools', 'semgrep');
  env.SEMGREP_ENABLE_VERSION_CHECK = '0';
  env.SEMGREP_SEND_METRICS = 'off';
  env.SEMGREP_SETTINGS_FILE = join(toolsDir, 'settings.yml');
  env.SEMGREP_LOG_FILE = join(toolsDir, 'semgrep.log');
  return env;
}

function formatFinding(finding: SemgrepFinding): string {
  const line = finding.start?.line ?? '?';
  const severity = finding.extra?.severity ?? '';
  const message = (finding.extra?.message ?? '').split('\n')[0]?.slice(0, 200) ?? '';
  return `- line ${line}: ${finding.check_id} [${severity}] ${message}`;
}

/** Returns the hook's stdout ('' for no output). Never throws. */
export async function runSemgrepEditHook(
  input: string,
  env: Record<string, string | undefined>,
  deps: SemgrepEditHookDeps = {},
): Promise<string> {
  try {
    if (env.OVERDECK_DOCKER_WORKSPACE === '1' || env.PAN_DOCKER === '1') return '';

    let event: PostToolUseEvent;
    try {
      event = JSON.parse(input) as PostToolUseEvent;
    } catch {
      return '';
    }
    if (event.tool_name !== 'Edit' && event.tool_name !== 'Write' && event.tool_name !== 'MultiEdit') return '';

    const agentId = env.OVERDECK_AGENT_ID;
    if (!agentId) return '';
    const home = env.OVERDECK_HOME || join(env.HOME ?? homedir(), '.overdeck');

    const exists = deps.exists ?? defaultExists;
    const readFile = deps.readFile ?? ((path: string) => readFileFs(path, 'utf8'));
    const statePath = join(home, 'agents', agentId, 'state.json');
    if (!(await exists(statePath))) return '';
    let role: unknown;
    try {
      const raw = await readFile(statePath);
      role = (JSON.parse(raw) as { role?: unknown }).role;
    } catch {
      return '';
    }
    if (role !== 'work') return '';

    const filePathRaw = event.tool_input?.file_path;
    if (typeof filePathRaw !== 'string' || filePathRaw.length === 0) return '';
    const cwd = typeof event.cwd === 'string' && event.cwd.length > 0 ? event.cwd : process.cwd();
    const file = isAbsolute(filePathRaw) ? filePathRaw : join(cwd, filePathRaw);

    if (file.includes('/node_modules/') || file.includes('/.git/') || file.includes('/dist/')) return '';
    if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) return '';

    const stat = deps.stat ?? statFs;
    let fileStat: { isFile(): boolean; size: number };
    try {
      fileStat = await stat(file);
    } catch {
      return '';
    }
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_SIZE) return '';

    const lstat = deps.lstat ?? lstatFs;
    const readlink = deps.readlink ?? readlinkFs;
    const bin = join(home, 'bin', 'semgrep');
    const expectedTarget = join(home, 'tools', 'semgrep', 'bin', 'semgrep');
    try {
      const binStat = await lstat(bin);
      if (!binStat.isSymbolicLink()) return '';
      if ((await readlink(bin)) !== expectedTarget) return '';
    } catch {
      return '';
    }

    const configs = ['--config', 'p/default'];
    if (await exists(join(cwd, '.semgrep.yml'))) configs.push('--config', join(cwd, '.semgrep.yml'));
    if (await exists(join(cwd, '.semgrep'))) configs.push('--config', join(cwd, '.semgrep'));

    const execFile = deps.execFile ?? execFileAsync;
    let stdout: string;
    try {
      const result = await execFile(bin, ['scan', '--json', '--quiet', '--metrics=off', ...configs, file], {
        cwd,
        env: semgrepScanEnv(env, home),
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      const err = error as { code?: number; stdout?: string };
      if (err.code === 1 && typeof err.stdout === 'string') {
        stdout = err.stdout;
      } else {
        return '';
      }
    }

    let parsed: { results?: SemgrepFinding[] };
    try {
      parsed = JSON.parse(stdout) as { results?: SemgrepFinding[] };
    } catch {
      return '';
    }
    const results = parsed.results ?? [];
    if (results.length === 0) return '';

    const lines = results.slice(0, MAX_FINDINGS).map(formatFinding);
    if (results.length > MAX_FINDINGS) lines.push(`…and ${results.length - MAX_FINDINGS} more`);

    const text = [
      `Semgrep found ${results.length} issue(s) in ${relative(cwd, file)}:`,
      ...lines,
      'Fix each one. If one is a false positive, add `nosemgrep: <rule-id>` with a one-line reason on that line (see the semgrep skill).',
    ].join('\n');

    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
  } catch {
    return '';
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = readFileSync(0, 'utf-8');
  runSemgrepEditHook(input, process.env)
    .then((output) => {
      if (output) process.stdout.write(output);
    })
    .catch(() => undefined)
    .finally(() => process.exit(0));
}

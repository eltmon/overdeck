/**
 * PAN-3920 W20 / AC-20 — the Codex-plugin job adapter. Scans run against a
 * temp plugin root, a temp Codex home and a temp OVERDECK_HOME with real
 * awaits; only the 15 s schedule runs under fake timers, with a no-I/O scan.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CODEX_PLUGIN_SCAN_MS,
  _resetCodexPluginImporterForTests,
  issueFromCwd,
  parseThreadReady,
  scanCodexPluginJobsOnce,
  startCodexPluginImporter,
  stopCodexPluginImporter,
  walkForRollout,
  type CodexPluginImporterDeps,
} from '../codex-plugin-importer.js';

const THREAD = '01a0bd4a-929d-76f1-93af-506462142d3f';
const SESSION = 'b4e68a48-1e09-4d98-92ef-e522535f1e58';

let base: string;
let pluginRoot: string;
let codexHome: string;
let overdeckHome: string;
let previousHome: string | undefined;
let previousCodexHome: string | undefined;

function jobsDir(): string {
  return join(pluginRoot, 'state', 'overdeck-b289e7acb782d40b', 'jobs');
}

function writeJob(id: string, fields: Record<string, unknown>): string {
  mkdirSync(jobsDir(), { recursive: true });
  const logFile = join(jobsDir(), `${id}.log`);
  writeFileSync(join(jobsDir(), `${id}.json`), JSON.stringify({
    id,
    kind: 'task',
    kindLabel: 'rescue',
    summary: 'Fix the flaky test',
    sessionId: SESSION,
    createdAt: '2026-09-20T05:29:35.634Z',
    logFile,
    request: { cwd: '/home/op/Projects/overdeck/workspaces/feature-pan-3950', model: 'gpt-5.6-sol' },
    ...fields,
  }));
  return logFile;
}

function writeRollout(): string {
  const created = new Date('2026-09-20T05:29:35.634Z');
  const dir = join(codexHome, 'sessions', String(created.getFullYear()),
    String(created.getMonth() + 1).padStart(2, '0'), String(created.getDate()).padStart(2, '0'));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `rollout-2026-09-20T01-29-36-${THREAD}.jsonl`);
  writeFileSync(path, '');
  return path;
}

function deps(overrides: CodexPluginImporterDeps = {}): CodexPluginImporterDeps {
  return {
    root: pluginRoot,
    codexHome,
    listConversations: async () => [{ tmuxSession: 'conv-orchestrator', claudeSessionId: SESSION }],
    listAgentDirs: async () => [],
    readSessionIndex: async () => [],
    readPidStartTime: async () => '9001',
    warn: vi.fn(),
    ...overrides,
  };
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

const registrationOf = (jobId: string) => JSON.parse(readFileSync(
  join(overdeckHome, 'agents', `ext-codex-plugin-${jobId}`, 'registration.json'), 'utf8'));
const sessionsOf = (jobId: string) => readFileSync(join(overdeckHome, 'agents', `ext-codex-plugin-${jobId}`, 'sessions.json'), 'utf8');

beforeEach(() => {
  _resetCodexPluginImporterForTests();
  base = mkdtempSync(join(tmpdir(), 'codex-plugin-importer-'));
  pluginRoot = join(base, 'plugin');
  codexHome = join(base, 'codex');
  overdeckHome = join(base, 'overdeck');
  mkdirSync(pluginRoot, { recursive: true });
  previousHome = process.env.OVERDECK_HOME;
  previousCodexHome = process.env.CODEX_HOME;
  process.env.OVERDECK_HOME = overdeckHome;
  // Rollouts must sit under $CODEX_HOME/sessions, one of the transcript roots.
  process.env.CODEX_HOME = codexHome;
});

afterEach(() => {
  _resetCodexPluginImporterForTests();
  vi.useRealTimers();
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  rmSync(base, { recursive: true, force: true });
});

describe('scanCodexPluginJobsOnce', () => {
  it('registers a running job with its pid, start time, issue and parent conversation', async () => {
    writeJob('task-run-1', { status: 'running', pid: 4242 });
    const result = await scanCodexPluginJobsOnce(deps());
    expect(result).toMatchObject({ jobs: 1, registered: 1 });
    expect(registrationOf('task-run-1')).toMatchObject({
      id: 'ext-codex-plugin-task-run-1',
      source: 'codex-plugin',
      externalId: 'task-run-1',
      harness: 'codex',
      model: 'gpt-5.6-sol',
      issueId: 'PAN-3950',
      parentId: 'conv-orchestrator',
      label: 'Fix the flaky test',
      pid: 4242,
      pidStartTime: '9001',
    });
  });

  it('records the rollout path of a completed job with a threadId, and no pid', async () => {
    const rollout = writeRollout();
    writeJob('task-done-1', { status: 'completed', pid: null, threadId: THREAD });
    const result = await scanCodexPluginJobsOnce(deps());
    expect(result).toMatchObject({ registered: 1, transcripts: 1 });
    expect(registrationOf('task-done-1')).toMatchObject({ pid: null, pidStartTime: null });
    expect(JSON.parse(sessionsOf('task-done-1').trim())).toMatchObject({ sessionId: THREAD, harness: 'codex', path: rollout });
  });

  it('reads the thread id from the job log while the job is still running', async () => {
    const rollout = writeRollout();
    const log = writeJob('task-run-2', { status: 'running', pid: 4242 });
    writeFileSync(log, `[2026-09-20T05:29:36.123Z] Starting Codex task thread.\n[2026-09-20T05:29:36.782Z] Thread ready (${THREAD}).\n`);
    await scanCodexPluginJobsOnce(deps());
    expect(sessionsOf('task-run-2')).toContain(rollout);
  });

  it('writes nothing on a second scan', async () => {
    writeRollout();
    writeJob('task-done-1', { status: 'completed', threadId: THREAD });
    writeJob('task-run-1', { status: 'running', pid: 4242 });
    await scanCodexPluginJobsOnce(deps());
    const before = snapshot(overdeckHome);
    const second = await scanCodexPluginJobsOnce(deps());
    expect(second).toMatchObject({ jobs: 2, registered: 0, transcripts: 0 });
    expect(snapshot(overdeckHome)).toEqual(before);
  });

  it('warns once about a malformed job across two scans', async () => {
    mkdirSync(jobsDir(), { recursive: true });
    writeFileSync(join(jobsDir(), 'task-bad.json'), '{ not json');
    writeFileSync(join(jobsDir(), 'task-nosession.json'), JSON.stringify({ id: 'task-nosession' }));
    const warn = vi.fn();
    await scanCodexPluginJobsOnce(deps({ warn }));
    await scanCodexPluginJobsOnce(deps({ warn }));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([message]) => message).join('\n')).toMatch(/task-bad\.json[\s\S]*task-nosession\.json/);
  });

  it('never writes under the plugin root', async () => {
    writeRollout();
    const log = writeJob('task-run-2', { status: 'running', pid: 4242 });
    writeFileSync(log, `Thread ready (${THREAD}).\n`);
    writeJob('task-done-1', { status: 'completed', threadId: THREAD });
    const before = snapshot(pluginRoot);
    await scanCodexPluginJobsOnce(deps());
    await scanCodexPluginJobsOnce(deps());
    expect(snapshot(pluginRoot)).toEqual(before);
  });

  it('falls back to the agent whose sessions.json holds the session, then to claude-session:<id>', async () => {
    writeJob('task-a', { status: 'running', pid: 1 });
    await scanCodexPluginJobsOnce(deps({
      listConversations: async () => [],
      listAgentDirs: async () => ['agent-pan-3950', 'ext-codex-plugin-other'],
      readSessionIndex: async (dir) => (dir === 'agent-pan-3950' ? [{ sessionId: SESSION, at: '', source: 'launcher' }] : []),
    }));
    expect(registrationOf('task-a').parentId).toBe('agent-pan-3950');

    writeJob('task-b', { status: 'running', pid: 1, sessionId: 'feed-0000' });
    await scanCodexPluginJobsOnce(deps({ listConversations: async () => { throw new Error('no db'); } }));
    expect(registrationOf('task-b').parentId).toBe('claude-session:feed-0000');
  });

  it('answers an empty result when the plugin has no data directory', async () => {
    expect(await scanCodexPluginJobsOnce(deps({ root: join(base, 'missing') }))).toEqual({ jobs: 0, registered: 0, transcripts: 0 });
  });
});

describe('scanCodexPluginJobsOnce — file safety (#4038 review)', () => {
  it('never opens a FIFO job log, and the scan still finishes', async () => {
    const log = writeJob('task-fifo', { status: 'running', pid: 4242 });
    execFileSync('mkfifo', [log]);
    const result = await scanCodexPluginJobsOnce(deps());
    expect(result).toMatchObject({ jobs: 1, registered: 1, transcripts: 0 });
  });

  it('ignores a job log that symlinks out of the plugin root', async () => {
    writeRollout();
    const outsideLog = join(base, 'outside.log');
    writeFileSync(outsideLog, `Thread ready (${THREAD}).\n`);
    const log = writeJob('task-escape', { status: 'running', pid: 4242 });
    symlinkSync(outsideLog, log);
    expect(await parseThreadReady(log, pluginRoot)).toBeNull();
    expect(await scanCodexPluginJobsOnce(deps())).toMatchObject({ registered: 1, transcripts: 0 });
  });

  it('skips a FIFO named like a job record', async () => {
    mkdirSync(jobsDir(), { recursive: true });
    execFileSync('mkfifo', [join(jobsDir(), 'task-pipe.json')]);
    expect(await scanCodexPluginJobsOnce(deps())).toEqual({ jobs: 0, registered: 0, transcripts: 0 });
  });

  it('does not link a rollout that is not a regular file under the Codex sessions root', async () => {
    writeJob('task-done-1', { status: 'completed', threadId: THREAD });
    const warn = vi.fn();
    const outside = join(base, `rollout-x-${THREAD}.jsonl`);
    writeFileSync(outside, '');
    await scanCodexPluginJobsOnce(deps({ warn, findRollout: async () => outside }));
    await scanCodexPluginJobsOnce(deps({ warn, findRollout: async () => outside }));
    expect(existsSync(join(overdeckHome, 'agents', 'ext-codex-plugin-task-done-1', 'sessions.json'))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/outside the allowed directories/);
  });

  it('treats a torn registration as not seen and rewrites it with the parent link', async () => {
    writeJob('task-run-1', { status: 'running', pid: 4242 });
    const dir = join(overdeckHome, 'agents', 'ext-codex-plugin-task-run-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'registration.json'), '{"id":"ext-codex-plu');
    expect(await scanCodexPluginJobsOnce(deps())).toMatchObject({ registered: 1 });
    expect(registrationOf('task-run-1')).toMatchObject({ parentId: 'conv-orchestrator', pid: 4242 });
  });
});

describe('walkForRollout', () => {
  it('finds a rollout below YYYY/MM/DD without the sync walk, newest first, and misses cleanly', async () => {
    const path = writeRollout();
    expect(await walkForRollout(join(codexHome, 'sessions'), THREAD)).toBe(path);
    expect(await walkForRollout(join(codexHome, 'sessions'), '00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await walkForRollout(join(base, 'missing'), THREAD)).toBeNull();
  });

  it('falls back to the walk when the rollout is not in the creation-day directory', async () => {
    const dir = join(codexHome, 'sessions', '2026', '01', '02');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `rollout-2026-01-02T00-00-00-${THREAD}.jsonl`);
    writeFileSync(path, '');
    writeJob('task-done-1', { status: 'completed', threadId: THREAD });
    await scanCodexPluginJobsOnce(deps());
    expect(sessionsOf('task-done-1')).toContain(path);
  });
});

describe('issueFromCwd', () => {
  it('reads the issue from a feature workspace path', () => {
    expect(issueFromCwd('/p/overdeck/workspaces/feature-pan-3920/src')).toBe('PAN-3920');
    expect(issueFromCwd('/p/overdeck/workspaces/feature-min-1039')).toBe('MIN-1039');
    expect(issueFromCwd('/p/overdeck')).toBeNull();
    expect(issueFromCwd(null)).toBeNull();
  });
});

describe('startCodexPluginImporter', () => {
  it('scans at start and every 15 s until stopped, skipping a tick while a scan is in flight', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const scan = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    expect(startCodexPluginImporter({}, scan)).toBe(true);
    expect(startCodexPluginImporter({}, scan)).toBe(false);
    expect(scan).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CODEX_PLUGIN_SCAN_MS);
    expect(scan).toHaveBeenCalledTimes(1); // first scan still running
    release();
    await vi.advanceTimersByTimeAsync(CODEX_PLUGIN_SCAN_MS);
    expect(scan).toHaveBeenCalledTimes(2);

    stopCodexPluginImporter();
    release();
    await vi.advanceTimersByTimeAsync(CODEX_PLUGIN_SCAN_MS * 3);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

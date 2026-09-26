import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIME_AGENT_MANAGED_POLICY } from '../policy.js';
import {
  buildPrimeAgentChildArgs,
  splitAppendSystemPrompt,
  startPrimeAgentHost,
  type PrimeAgentChild,
  type PrimeAgentHost,
  type PrimeAgentHostDeps,
  type PrimeAgentHostOptions,
} from '../host.js';

type Command = Record<string, unknown> & { type: string; id?: string };
type Responder = (command: Command, child: FakePrimeChild) => Record<string, unknown> | undefined | null;

/** A fake `prime-agent --mode rpc` child: reads JSONL commands on stdin, answers on stdout. */
class FakePrimeChild extends EventEmitter implements PrimeAgentChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly commands: Command[] = [];
  readonly killed: string[] = [];
  private buffer = '';

  constructor(private readonly respond: Responder) {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf('\n');
        if (!line.trim()) continue;
        const command = JSON.parse(line) as Command;
        this.commands.push(command);
        const data = this.respond(command, this);
        if (data === null || !command.id) continue;
        this.emitRecord({ type: 'response', id: command.id, command: command.type, success: true, ...(data ? { data } : {}) });
      }
    });
    this.stdin.on('finish', () => this.exit(0));
  }

  emitRecord(record: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(record)}\n`);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code ?? 1;
    this.emit('exit', code, signal);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal);
    this.exit(null, signal);
    return true;
  }
}

function standardResponder(state: { sessionFile: string; sessionId: string; isStreaming?: boolean }): Responder {
  return (command) => {
    if (command.type === 'get_state') return { sessionFile: state.sessionFile, sessionId: state.sessionId, isStreaming: state.isStreaming ?? false };
    if (command.type === 'get_session_stats') return { tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.01 };
    if (command.type === 'extension_ui_response') return null;
    return undefined;
  };
}

function post(socketPath: string, token: string | undefined, body: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolvePost, reject) => {
    const req = httpRequest({
      socketPath,
      path: '/',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(token ? { 'x-overdeck-bridge-token': token } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolvePost({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) as Record<string, unknown> : {} }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('Prime Agent host (PAN-3668 WI-11)', () => {
  let home: string;
  let agentDir: string;
  let workspace: string;
  let hosts: PrimeAgentHost[];

  const agentId = 'agent-prime-host';
  const socketPath = () => join(home, 'sockets', `prime-agent-${agentId}.sock`);
  const token = () => readFileSync(join(agentDir, 'prime-agent-token'), 'utf8').trim();

  function options(overrides: Partial<PrimeAgentHostOptions> = {}): PrimeAgentHostOptions {
    return { agentId, binaryPath: '/usr/bin/prime-agent', workspace, provider: 'kimi-coding', model: 'k3', overdeckHome: home, ...overrides };
  }

  function deps(child: FakePrimeChild, overrides: Partial<PrimeAgentHostDeps> = {}) {
    const reapDaemon = vi.fn(async () => 'none' as const);
    const appendSessionHistory = vi.fn();
    const spawnChild = vi.fn(() => child);
    return {
      reapDaemon,
      appendSessionHistory,
      spawnChild,
      deps: { spawnChild, readVersion: async () => 'prime-agent 0.8.0\n', reapDaemon, appendSessionHistory, ...overrides } satisfies PrimeAgentHostDeps,
    };
  }

  async function start(opts: PrimeAgentHostOptions, hostDeps: PrimeAgentHostDeps): Promise<PrimeAgentHost> {
    const host = await startPrimeAgentHost(opts, hostDeps);
    hosts.push(host);
    return host;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-prime-host-'));
    agentDir = join(home, 'agents', agentId);
    workspace = join(home, 'workspace');
    mkdirSync(workspace, { recursive: true });
    hosts = [];
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(hosts.map((host) => host.stop()));
    rmSync(home, { recursive: true, force: true });
  });

  it('builds the D9 argv with a private daemon socket and the managed policy first', () => {
    const args = buildPrimeAgentChildArgs({
      daemonSocket: '/h/sockets/pd-0123456789abcdef.sock',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      sessionDir: '/h/agents/a/prime-sessions',
      thinking: 'high',
      resumeSessionFile: '/h/agents/a/prime-sessions/s.jsonl',
      context: 'layer one\n\nlayer two',
    });
    expect(args.slice(0, 11)).toEqual([
      '--mode', 'rpc',
      '--daemon-socket', '/h/sockets/pd-0123456789abcdef.sock',
      '--provider', 'openai-codex',
      '--model', 'gpt-5.5',
      '--session-dir', '/h/agents/a/prime-sessions',
      '--no-extensions',
    ]);
    expect(args).toContain('--thinking');
    expect(args).toContain('--resume');
    const prompts = args.flatMap((arg, index) => (arg === '--append-system-prompt' ? [args[index + 1]] : []));
    expect(prompts).toEqual([PRIME_AGENT_MANAGED_POLICY, 'layer one\n\nlayer two']);
    for (const forbidden of ['--goal', '--autonomous', '--continue', '--no-session', '--offline']) {
      expect(args).not.toContain(forbidden);
    }
  });

  it('splits large context on paragraph boundaries below the argv limit', () => {
    const paragraph = 'x'.repeat(60);
    const chunks = splitAppendSystemPrompt([paragraph, paragraph, paragraph].join('\n\n'), 130);
    expect(chunks).toEqual([`${paragraph}\n\n${paragraph}`, paragraph]);
    expect(splitAppendSystemPrompt('y'.repeat(250), 100).map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });

  it('writes the token, the session-file pointer, then the session id, and records sessions.json', async () => {
    const sessionFile = join(agentDir, 'prime-sessions', 'file-uuid.jsonl');
    const child = new FakePrimeChild(standardResponder({ sessionFile, sessionId: 'id-uuid' }));
    const ctx = deps(child);
    await start(options(), ctx.deps);

    expect(token()).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(agentDir, 'prime-agent-session-file'), 'utf8').trim()).toBe(sessionFile);
    expect(readFileSync(join(agentDir, 'prime-agent-session-id'), 'utf8').trim()).toBe('id-uuid');
    expect(existsSync(socketPath())).toBe(true);
    expect(ctx.appendSessionHistory).toHaveBeenCalledWith(agentId, 'id-uuid', 'prime-agent-host', { harness: 'prime-agent', model: 'k3', path: sessionFile });
    expect(ctx.reapDaemon).toHaveBeenCalledWith(agentId, '/usr/bin/prime-agent', home);
    const spawnArgs = ctx.spawnChild.mock.calls[0] as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    expect(spawnArgs[2].cwd).toBe(workspace);
    expect(spawnArgs[2].env.PI_SKIP_VERSION_CHECK).toBe('1');
    expect(spawnArgs[1][spawnArgs[1].indexOf('--daemon-socket') + 1]).toMatch(/\/sockets\/pd-[0-9a-f]{16}\.sock$/);
  });

  it('sends prompt when idle and steer when streaming, and returns 202 with the command', async () => {
    const state = { sessionFile: join(agentDir, 'prime-sessions', 's.jsonl'), sessionId: 'id-1', isStreaming: false };
    const child = new FakePrimeChild(standardResponder(state));
    await start(options(), deps(child).deps);

    const idle = await post(socketPath(), token(), JSON.stringify({ op: 'message', content: 'first' }));
    expect(idle.status).toBe(202);
    expect(idle.body).toMatchObject({ accepted: true, command: 'prompt' });
    expect(child.commands.find((command) => command.type === 'prompt')).toMatchObject({ message: 'first', streamingBehavior: 'steer' });

    state.isStreaming = true;
    const streaming = await post(socketPath(), token(), JSON.stringify({ op: 'message', content: 'second' }));
    expect(streaming.status).toBe(202);
    expect(streaming.body).toMatchObject({ accepted: true, command: 'steer' });
    expect(child.commands.find((command) => command.type === 'steer')).toMatchObject({ message: 'second' });
  });

  it('serves status, interrupt and set-effort, and rejects unknown levels', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: join(agentDir, 's.jsonl'), sessionId: 'id-2' }));
    await start(options(), deps(child).deps);

    await expect(post(socketPath(), token(), '{"op":"status"}')).resolves.toMatchObject({ status: 200, body: { state: 'ready', sessionId: 'id-2', isStreaming: false } });
    await expect(post(socketPath(), token(), '{"op":"interrupt"}')).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(child.commands.some((command) => command.type === 'abort')).toBe(true);
    await expect(post(socketPath(), token(), '{"op":"set-effort","effort":"xhigh"}')).resolves.toEqual({ status: 200, body: { ok: true, effort: 'xhigh' } });
    expect(child.commands.find((command) => command.type === 'set_thinking_level')).toMatchObject({ level: 'xhigh' });
    await expect(post(socketPath(), token(), '{"op":"set-effort","effort":"ultra"}')).resolves.toMatchObject({ status: 400 });
  });

  it('rejects a wrong token with 401 and an oversized body with 413', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: join(agentDir, 's.jsonl'), sessionId: 'id-3' }));
    await start(options(), deps(child).deps);

    await expect(post(socketPath(), 'wrong-token', '{"op":"status"}')).resolves.toMatchObject({ status: 401 });
    await expect(post(socketPath(), token(), JSON.stringify({ op: 'message', content: 'z'.repeat(2_000_000) }))).resolves.toMatchObject({ status: 413 });
  });

  it('auto-cancels extension dialogs (D10)', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: join(agentDir, 's.jsonl'), sessionId: 'id-4' }));
    await start(options(), deps(child).deps);

    child.emitRecord({ type: 'extension_ui_request', id: 'ui-7', method: 'confirm', title: 'Proceed?', message: 'ok?' });
    child.emitRecord({ type: 'extension_ui_request', id: 'ui-8', method: 'notify', message: 'fyi' });
    await vi.waitFor(() => {
      expect(child.commands).toContainEqual({ type: 'extension_ui_response', id: 'ui-7', cancelled: true });
    });
    expect(child.commands.some((command) => command.id === 'ui-8')).toBe(false);
  });

  it('writes debounced stats after agent_end under fake timers', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: join(agentDir, 's.jsonl'), sessionId: 'id-5' }));
    const host = await start(options(), deps(child).deps);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    child.emitRecord({ type: 'agent_start' });
    child.emitRecord({ type: 'agent_end', messages: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(child.commands.some((command) => command.type === 'get_session_stats')).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(child.commands.some((command) => command.type === 'get_session_stats')).toBe(true);
    vi.useRealTimers();

    await host.stop();
    const stats = JSON.parse(readFileSync(join(agentDir, 'prime-agent-stats.json'), 'utf8')) as { lastEventAt: string; stats: { cost: number } };
    expect(stats.stats.cost).toBe(0.01);
    expect(Date.parse(stats.lastEventAt)).not.toBeNaN();
  });

  it('becomes ready on resume when the session file and recorded id match', async () => {
    const sessionFile = join(agentDir, 'prime-sessions', 'resume.jsonl');
    mkdirSync(join(agentDir, 'prime-sessions'), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    writeFileSync(join(agentDir, 'prime-agent-session-id'), 'id-stable\n');
    const child = new FakePrimeChild(standardResponder({ sessionFile, sessionId: 'id-stable' }));
    const ctx = deps(child);
    await start(options({ resumeSessionFile: sessionFile }), ctx.deps);

    const spawnArgs = ctx.spawnChild.mock.calls[0] as unknown as [string, string[]];
    expect(spawnArgs[1][spawnArgs[1].indexOf('--resume') + 1]).toBe(sessionFile);
    expect(readFileSync(join(agentDir, 'prime-agent-session-id'), 'utf8').trim()).toBe('id-stable');
  });

  it('refuses a resume whose session id changed, writes the launch error and reaps the daemon', async () => {
    const sessionFile = join(agentDir, 'prime-sessions', 'resume.jsonl');
    mkdirSync(join(agentDir, 'prime-sessions'), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    writeFileSync(join(agentDir, 'prime-agent-session-id'), 'id-old\n');
    const child = new FakePrimeChild(standardResponder({ sessionFile, sessionId: 'id-new' }));
    const ctx = deps(child);

    await expect(startPrimeAgentHost(options({ resumeSessionFile: sessionFile }), ctx.deps)).rejects.toThrow(/id-new.*id-old/);
    expect(readFileSync(join(agentDir, 'prime-agent-launch-error'), 'utf8')).toContain('The replacement session was stopped');
    expect(existsSync(join(agentDir, 'prime-agent-session-id'))).toBe(false);
    expect(ctx.reapDaemon).toHaveBeenCalledTimes(2);
    expect(child.exitCode).not.toBeNull();
    expect(existsSync(socketPath())).toBe(false);
  });

  it('refuses a Prime version outside the supported range before spawning', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: 's', sessionId: 'i' }));
    const ctx = deps(child, { readVersion: async () => '0.7.2\n' });

    await expect(startPrimeAgentHost(options(), ctx.deps)).rejects.toThrow('0.8.0 – <0.9.0');
    expect(readFileSync(join(agentDir, 'prime-agent-launch-error'), 'utf8')).toContain('Prime Agent 0.7.2 is outside the supported range 0.8.0 – <0.9.0');
    expect(ctx.spawnChild).not.toHaveBeenCalled();
  });

  it('reports a child that exits before ready, including its stderr tail', async () => {
    const child = new FakePrimeChild(() => null);
    const ctx = deps(child, {
      spawnChild: () => {
        setImmediate(() => {
          child.stderr.write('Unknown model "nope" for provider kimi-coding\n');
          setImmediate(() => child.exit(1));
        });
        return child;
      },
    });

    await expect(startPrimeAgentHost(options({ model: 'nope' }), ctx.deps)).rejects.toThrow('Prime Agent exited with code 1');
    const launchError = readFileSync(join(agentDir, 'prime-agent-launch-error'), 'utf8');
    expect(launchError).toContain('Prime Agent exited with code 1');
    expect(launchError).toContain('Unknown model "nope"');
  });

  it('stops the child, reaps the daemon and removes the socket on stop', async () => {
    const child = new FakePrimeChild(standardResponder({ sessionFile: join(agentDir, 's.jsonl'), sessionId: 'id-6' }));
    const ctx = deps(child);
    const host = await start(options(), ctx.deps);

    await host.stop();
    await expect(host.closed).resolves.toBe(0);
    expect(child.exitCode).toBe(0);
    expect(ctx.reapDaemon).toHaveBeenCalledTimes(2);
    expect(existsSync(socketPath())).toBe(false);
  });
});

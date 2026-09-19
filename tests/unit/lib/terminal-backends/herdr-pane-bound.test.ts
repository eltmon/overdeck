/**
 * PAN-3917 W12: harnesses Herdr cannot detect are launched PANE-BOUND.
 *
 * Herdr's detector reads the pane's foreground process. Every harness Overdeck
 * runs through a host process (codex app-server, ACP, kimi-code, ohmypi/muse)
 * puts `node …-host.js` there, so detection never fires and the old start path
 * closed a healthy pane after 60s — exactly how `agent-pan-3705-review` (codex,
 * gpt-5.6-sol) went `starting → error` 61s after launch on 2026-09-19 while its
 * app-server host was already connected.
 */
import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

import {
  AGENT_ID_TOKEN,
  findHerdrAgent,
  HerdrBackend,
  listHerdrAgents,
  probeHerdrAgentLiveness,
} from '../../../../src/lib/terminal-backends/herdr.js';
import { HerdrApiError } from '../../../../src/lib/terminal-backends/herdr-api.js';
import { detectionPolicyFor, launchAgentPane } from '../../../../src/lib/terminal-backends/launch.js';
import { resetPromptGuard } from '../../../../src/lib/terminal-backends/prompt-guard.js';
import {
  isUnsupported,
  type StartAgentSpec,
  type TerminalBackend,
  type WorkspaceRef,
} from '../../../../src/lib/terminal-backends/types.js';

interface Call { method: string; params: Record<string, unknown> }

function fakeApi(handler: (call: Call) => unknown, log: Call[] = []) {
  return {
    log,
    api: {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        const result = handler({ method, params });
        if (result instanceof Error) throw result;
        return result ?? {};
      },
    },
  };
}

const workspace: WorkspaceRef = {
  backend: 'herdr',
  workspaceId: 'wE',
  issueId: 'PAN-3705',
  cwd: '/w/feature-pan-3705',
};

const codexSpec: StartAgentSpec = {
  kind: 'codex',
  argv: ['bash', '/home/e/.overdeck/agents/agent-pan-3705-review/launcher.sh'],
  env: { OVERDECK_AGENT_ID: 'agent-pan-3705-review' },
  tokens: { issue: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' },
  name: 'agent-pan-3705-review',
  detection: 'not-required',
};

describe('detectionPolicyFor', () => {
  it('requires detection only where the harness CLI is the pane process', () => {
    expect(detectionPolicyFor('claude-code')).toBe('required');
    for (const harness of ['codex', 'acp', 'opencode', 'kimi-code', 'ohmypi', 'muse']) {
      expect(detectionPolicyFor(harness)).toBe('not-required');
    }
  });

  it('is what the launcher puts on the start spec', async () => {
    const specs: StartAgentSpec[] = [];
    const backend = {
      name: 'herdr',
      workspaceFor: () => Effect.succeed(workspace),
      startAgent: (_ws: WorkspaceRef, spec: StartAgentSpec) => {
        specs.push(spec);
        return Effect.succeed({
          backend: 'herdr' as const, workspaceId: 'wE', paneId: 'wE:p2', terminalId: 't2', agentName: spec.name ?? '',
        });
      },
    } as unknown as TerminalBackend;

    for (const harness of ['claude-code', 'codex']) {
      await launchAgentPane({
        issueId: 'PAN-3705',
        cwd: '/w',
        agentId: `agent-pan-3705-${harness}`,
        argv: ['bash', 'launcher.sh'],
        env: {},
        tokens: { issue: 'PAN-3705', role: 'review', harness, model: 'm' },
      }, backend);
    }

    expect(specs.map((spec) => spec.detection)).toEqual(['required', 'not-required']);
  });
});

describe('HerdrBackend.startAgent, pane-bound', () => {
  it('returns the pane immediately: no detection wait, no rename, no failure', async () => {
    vi.useFakeTimers();
    try {
      const { api, log } = fakeApi(({ method }) =>
        method === 'pane.split'
          ? { pane: { pane_id: 'wE:p2', terminal_id: 'term_9', workspace_id: 'wE' } }
          : {});

      // No timer advance at all: the launch must settle on its own.
      const pane = await Effect.runPromise(new HerdrBackend(api as never).startAgent(workspace, codexSpec));

      expect(pane).toMatchObject({
        backend: 'herdr',
        workspaceId: 'wE',
        paneId: 'wE:p2',
        terminalId: 'term_9',
        agentName: 'agent-pan-3705-review',
      });
      const methods = log.map((call) => call.method);
      expect(methods).toEqual(['pane.split', 'pane.report_metadata', 'pane.send_input']);
      expect(methods).not.toContain('agent.rename');
      expect(methods).not.toContain('pane.get');
      expect(methods).not.toContain('pane.close');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stamps identity BEFORE the launcher runs, so a pane that dies early still says what it was', async () => {
    const { api, log } = fakeApi(({ method }) =>
      method === 'pane.split' ? { pane: { pane_id: 'wE:p2', terminal_id: 'term_9', workspace_id: 'wE' } } : {});

    await Effect.runPromise(new HerdrBackend(api as never).startAgent(workspace, codexSpec));

    const methods = log.map((call) => call.method);
    expect(methods.indexOf('pane.report_metadata')).toBeLessThan(methods.indexOf('pane.send_input'));
    expect(log.find((call) => call.method === 'pane.report_metadata')?.params).toMatchObject({
      pane_id: 'wE:p2',
      source: 'overdeck',
      tokens: {
        issue: 'PAN-3705',
        role: 'review',
        harness: 'codex',
        model: 'gpt-5.6-sol',
        [AGENT_ID_TOKEN]: 'agent-pan-3705-review',
      },
      title: 'agent-pan-3705-review',
      display_agent: 'codex',
    });
  });

  it('closes the pane when the launcher cannot be sent', async () => {
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.split') return { pane: { pane_id: 'wE:p2', terminal_id: 't', workspace_id: 'wE' } };
      if (method === 'pane.send_input') return new HerdrApiError({ method, code: 'pane_busy', message: 'pane busy' });
      return {};
    });

    const error = await Effect.runPromise(
      Effect.flip(new HerdrBackend(api as never).startAgent(workspace, codexSpec)),
    );

    expect(error.message).toContain('pane busy');
    expect(log.find((call) => call.method === 'pane.close')?.params).toMatchObject({ pane_id: 'wE:p2' });
  });

  it('keeps stamping the agent id on the detected path, so the inventory keys both alike', async () => {
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.split') return { pane: { pane_id: 'wE:p3', terminal_id: 't', workspace_id: 'wE' } };
      if (method === 'pane.get') return { pane: { pane_id: 'wE:p3', terminal_id: 't', workspace_id: 'wE', agent: 'claude' } };
      return {};
    });

    await Effect.runPromise(new HerdrBackend(api as never).startAgent(workspace, {
      ...codexSpec,
      kind: 'claude-code',
      tokens: { ...codexSpec.tokens, harness: 'claude-code' },
      name: 'agent-pan-3705',
      detection: 'required',
    }));

    expect(log.some((call) => call.method === 'agent.rename')).toBe(true);
    expect(log.find((call) => call.method === 'pane.report_metadata')?.params)
      .toMatchObject({ tokens: { [AGENT_ID_TOKEN]: 'agent-pan-3705' } });
  });
});

const boundPane = {
  pane_id: 'wE:p2',
  terminal_id: 'term_9',
  workspace_id: 'wE',
  agent_status: 'unknown',
  tokens: {
    issue: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol',
    [AGENT_ID_TOKEN]: 'agent-pan-3705-review',
  },
};

/**
 * A pane running its harness: the foreground process is the app-server host,
 * not the pane's own shell. Verified live — an idle pane instead reports
 * `[bash]` with `pid === shell_pid`.
 */
const runningProcessInfo = {
  process_info: {
    pane_id: 'wE:p2',
    shell_pid: 1525697,
    foreground_process_group_id: 1527509,
    foreground_processes: [{ pid: 1527509, name: 'node', cmdline: 'node dist/codex-app-server-host.js' }],
  },
};

/** The same pane after the host exited: the shell is back at its prompt. */
const idleShellProcessInfo = {
  process_info: {
    pane_id: 'wE:p2',
    shell_pid: 1525697,
    foreground_process_group_id: 1525697,
    foreground_processes: [{ pid: 1525697, name: 'bash', cmdline: '/bin/bash' }],
  },
};

function paneBoundApi(log: Call[] = [], processInfo: unknown = runningProcessInfo) {
  return fakeApi(({ method }) => {
    if (method === 'agent.get') return new HerdrApiError({ method, code: 'not_found', message: 'no such agent' });
    if (method === 'agent.list') return { agents: [] };
    if (method === 'session.snapshot') return { snapshot: { panes: [boundPane] } };
    if (method === 'pane.get') return { pane: boundPane };
    if (method === 'pane.process_info') return processInfo;
    return {};
  }, log);
}

describe('finding a pane-bound agent', () => {
  it('findHerdrAgent falls back to the agentId token', async () => {
    const { api } = paneBoundApi();
    await expect(findHerdrAgent('agent-pan-3705-review', api as never)).resolves.toMatchObject({
      paneId: 'wE:p2',
      terminalId: 'term_9',
      workspaceId: 'wE',
      state: 'unknown',
      paneBound: true,
    });
  });

  it('still answers null for an id nothing on this host carries', async () => {
    const { api } = paneBoundApi();
    await expect(findHerdrAgent('agent-pan-9999', api as never)).resolves.toBeNull();
  });

  it('answers null for a pane whose process has exited, so a respawn is not blocked', async () => {
    const { api } = paneBoundApi([], idleShellProcessInfo);
    await expect(findHerdrAgent('agent-pan-3705-review', api as never)).resolves.toBeNull();
  });

  it('lists the token-stamped pane as a live agent', async () => {
    const { api } = paneBoundApi();
    await expect(listHerdrAgents(api as never)).resolves.toEqual([{
      agentId: 'agent-pan-3705-review',
      paneId: 'wE:p2',
      terminalId: 'term_9',
      state: 'unknown',
      tokens: boundPane.tokens,
      paneBound: true,
    }]);
  });

  it('counts a pane Herdr later detected once, not twice', async () => {
    // Herdr names a detected agent itself; the agentId token is what keys it.
    const detected = { ...boundPane, agent: 'codex', agent_status: 'working', name: 'codex-1' };
    const { api } = fakeApi(({ method }) => {
      if (method === 'agent.list') return { agents: [detected] };
      if (method === 'session.snapshot') return { snapshot: { panes: [detected] } };
      return {};
    });

    const agents = await listHerdrAgents(api as never);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ agentId: 'agent-pan-3705-review', state: 'working', paneBound: false });
  });
});

describe('probeHerdrAgentLiveness for a pane-bound agent', () => {
  it('is alive while the pane runs a process of its own', async () => {
    const { api } = paneBoundApi();
    await expect(probeHerdrAgentLiveness('agent-pan-3705-review', api as never))
      .resolves.toEqual({ kind: 'alive', paneId: 'wE:p2', state: 'unknown' });
  });

  it('is EXITED once the pane is back at its shell prompt — the pane outlives the harness', async () => {
    // A Herdr pane does not close when the process typed into it dies. Reading
    // "the pane exists" as liveness would make every dead agent — pane-bound or
    // a claude-code agent whose name Herdr released — immortal, and nothing
    // would ever be confirmed dead.
    const { api } = paneBoundApi([], idleShellProcessInfo);
    await expect(probeHerdrAgentLiveness('agent-pan-3705-review', api as never))
      .resolves.toEqual({ kind: 'exited', paneId: 'wE:p2' });
  });

  it('is indeterminate when the process probe itself fails', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'agent.get') return new HerdrApiError({ method, code: 'not_found', message: 'no such agent' });
      if (method === 'session.snapshot') return { snapshot: { panes: [boundPane] } };
      if (method === 'pane.process_info') return new HerdrApiError({ method, code: 'timeout', message: 'no answer' });
      return {};
    });
    expect((await probeHerdrAgentLiveness('agent-pan-3705-review', api as never)).kind).toBe('indeterminate');
  });

  it('is absent once the pane is gone', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'agent.get') return new HerdrApiError({ method, code: 'not_found', message: 'no such agent' });
      if (method === 'session.snapshot') return { snapshot: { panes: [] } };
      return {};
    });
    await expect(probeHerdrAgentLiveness('agent-pan-3705-review', api as never))
      .resolves.toEqual({ kind: 'absent' });
  });

  it('is NEVER absent when the snapshot itself could not be read', async () => {
    // A Herdr outage folded into "absent" would reap every pane-bound agent.
    for (const code of ['timeout', 'socket_error', 'disconnected']) {
      const { api } = fakeApi(({ method }) => {
        if (method === 'agent.get') return new HerdrApiError({ method, code: 'not_found', message: 'no such agent' });
        return new HerdrApiError({ method, code, message: `herdr ${code}` });
      });
      const result = await probeHerdrAgentLiveness('agent-pan-3705-review', api as never);
      expect(result.kind).toBe('indeterminate');
    }
  });
});

describe('HerdrBackend.prompt for a pane-bound agent', () => {
  const sender = { id: 'conv-2781' };

  it('is unsupported — Herdr cannot prompt a pane it never detected', async () => {
    resetPromptGuard();
    const { api, log } = paneBoundApi();

    const result = await Effect.runPromise(
      new HerdrBackend(api as never).prompt({ paneId: 'wE:p2' }, 'review this', { messageId: 'm1', sender }),
    );

    expect(isUnsupported(result)).toBe(true);
    if (isUnsupported(result)) {
      expect(result.reason).toContain('wE:p2');
      expect(result.reason).toContain('codex');
    }
    expect(log.some((call) => call.method === 'agent.prompt')).toBe(false);
  });

  it('answers unsupported by agent name too, and does not consume the dedupe ring', async () => {
    resetPromptGuard();
    const { api } = paneBoundApi();
    const backend = new HerdrBackend(api as never);

    for (const attempt of [1, 2]) {
      const result = await Effect.runPromise(
        backend.prompt({ agentName: 'agent-pan-3705-review' }, `try ${attempt}`, { messageId: 'm1', sender }),
      );
      // The fall-through transport runs the guard itself; a slot burned here
      // would drop the real delivery as a duplicate.
      expect(isUnsupported(result)).toBe(true);
    }
  });
});

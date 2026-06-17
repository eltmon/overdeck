import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  getAgentDir: vi.fn((id: string) => join(process.env.PANOPTICON_HOME!, 'agents', id)),
  stopAgent: vi.fn(),
  saveAgentStateAndEmitEventProgram: vi.fn(),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  killSession: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../../../../lib/model-validation.js', () => ({
  requireModelOverrideSync: vi.fn((model: string) => model),
}));

let testHome: string;
let originalHome: string | undefined;

function decodeJsonResponse(response: { status: number; body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function postSwitchModel(agentId: string, body: Record<string, unknown>) {
  const { agentsRouteLayer } = await import('../agents.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/agents/${agentId}/switch-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3011' },
    body: JSON.stringify(body),
  }));

  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(agentsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
}

describe('POST /api/agents/:id/switch-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    testHome = join(tmpdir(), `pan-agent-switch-model-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = testHome;
    process.env.PANOPTICON_HOME = join(testHome, '.panopticon');
    mkdirSync(process.env.PANOPTICON_HOME, { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.PANOPTICON_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('rejects all agent model switches with a clear error', async () => {
    const response = await postSwitchModel('agent-pan-1234', { model: 'claude-fable-5' });

    expect(response.status).toBe(400);
    const body = decodeJsonResponse(response);
    expect(body.error).toMatch(/not allowed for agents/i);
  });
});

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

function decodeJsonResponse(response: { status: number; body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function postAgentSwitchModel(agentId: string, body: Record<string, unknown>) {
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
  it('rejects model switching for pipeline agents', async () => {
    const response = await postAgentSwitchModel('agent-pan-1928', { model: 'claude-fable-5' });

    expect(response.status).toBe(409);
    expect(decodeJsonResponse(response).error).toBe('Agent agent-pan-1928 model is locked once the agent is spawned');
  });
});

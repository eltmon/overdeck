import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../internal-token.js';

export interface SpawnWorkAgentResult {
  spawned: boolean;
  queued?: boolean;
  agentId?: string;
  skippedReason?: string;
  error?: string;
}

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function classifySpawnSkip(status: number, body: Record<string, unknown>): string {
  const error = typeof body['error'] === 'string' ? body['error'] : '';
  if (status === 401 || status === 403) return 'unauthorized';
  if (body['stackHealth'] || /workspace docker stack/i.test(error)) return 'stack-unhealthy';
  if (body['paused'] === true) return 'paused';
  if (body['troubled'] === true) return 'troubled';
  if (body['guardrails'] || body['requiresAcknowledgement'] === true || status === 409) return 'guardrails';
  if (body['providerHealth']) return 'provider-down';
  if (status === 422 && /already closed|closed issue|cannot start an agent for a closed issue/i.test(error)) return 'closed-issue';
  return 'spawn-failed';
}

export async function spawnWorkAgentThroughAgentsEndpoint(
  issueId: string,
  dashboardOrigin = internalDashboardOrigin(),
  autoSpawnConsentRequired = false,
  startedBy = 'orphan-proposed-reconciler',
): Promise<SpawnWorkAgentResult> {
  const internalToken = getInternalTokenSync();
  const response = await fetch(new URL('/api/agents', dashboardOrigin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: dashboardOrigin,
      ...(internalToken ? { [INTERNAL_TOKEN_HEADER]: internalToken } : {}),
    },
    body: JSON.stringify({
      issueId,
      role: 'work',
      startedBy,
      autoSpawnConsentRequired,
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : `agent-${issueId.toLowerCase()}`;

  if (response.ok && body['success'] !== false) {
    return { spawned: true, ...(body['startingContainers'] === true ? { queued: true } : {}), agentId };
  }

  return {
    spawned: false,
    skippedReason: classifySpawnSkip(response.status, body),
    error: typeof body['error'] === 'string'
      ? body['error']
      : typeof body['message'] === 'string'
        ? body['message']
        : `Work agent spawn returned HTTP ${response.status}`,
  };
}

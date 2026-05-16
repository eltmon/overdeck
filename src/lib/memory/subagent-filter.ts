export interface SubagentHookPayload {
  agent_id?: unknown;
}

export function isSubagentHookPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const agentId = payload.agent_id;
  return typeof agentId === 'string' && agentId.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

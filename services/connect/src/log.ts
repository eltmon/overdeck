/**
 * The only logging function in the directory Durable Object (NFR-2356-1): a log line names the
 * frame type, the environment id or the phone's client id, and the outcome, and never a label,
 * key, address or payload.
 */
export function logFrame(type: string, environmentId: string | null, outcome: string, clientId?: string): void {
  console.log(JSON.stringify({ frame: type, env: environmentId, outcome, ...(clientId !== undefined ? { client: clientId } : {}) }));
}

/**
 * The read model's agent rows for code outside an Effect route (PAN-4651
 * D-4651-15): the read model registers a reader when its layer builds, and the
 * fleet Needs-You feed (which also feeds the link heartbeat) reads agents'
 * pending input through it. Before the read model exists it answers no agents.
 */
export interface AgentPendingRow {
  id: string;
  issueId?: string | null;
  pendingInputKinds?: ReadonlyArray<string>;
}

let source: (() => Promise<ReadonlyArray<AgentPendingRow>>) | null = null;

export function setAgentSnapshotsSource(next: (() => Promise<ReadonlyArray<AgentPendingRow>>) | null): void {
  source = next;
}

export async function readAgentSnapshots(): Promise<ReadonlyArray<AgentPendingRow>> {
  return source ? source() : [];
}

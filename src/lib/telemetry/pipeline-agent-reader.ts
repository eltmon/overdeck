import type { Harness } from '@overdeck/contracts';

export interface PipelineTelemetryAgentState {
  harness?: Harness;
  model: string;
}

type PipelineTelemetryAgentReader = (
  agentId: string,
) => PipelineTelemetryAgentState | null;

let readAgentState: PipelineTelemetryAgentReader = () => null;

export function registerPipelineTelemetryAgentReader(
  reader: PipelineTelemetryAgentReader,
): void {
  readAgentState = reader;
}

export function readPipelineTelemetryAgentState(
  agentId: string,
): PipelineTelemetryAgentState | null {
  return readAgentState(agentId);
}

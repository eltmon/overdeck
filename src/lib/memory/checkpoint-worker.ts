import { parentPort } from 'node:worker_threads';
import {
  claimTranscriptRange,
  commitTranscriptRange,
  releaseTranscriptRange,
  getTranscriptCheckpoint,
  listTranscriptCheckpoints,
} from './checkpoints.js';

type CheckpointOperation =
  | 'claimTranscriptRange'
  | 'commitTranscriptRange'
  | 'releaseTranscriptRange'
  | 'getTranscriptCheckpoint'
  | 'listTranscriptCheckpoints';

interface CheckpointRequest {
  id: number;
  operation: CheckpointOperation;
  payload: unknown;
}

function runOperation(operation: CheckpointOperation, payload: unknown): unknown {
  switch (operation) {
    case 'claimTranscriptRange':
      return claimTranscriptRange(payload as Parameters<typeof claimTranscriptRange>[0]);
    case 'commitTranscriptRange':
      return commitTranscriptRange(payload as Parameters<typeof commitTranscriptRange>[0]);
    case 'releaseTranscriptRange': {
      const p = payload as { sessionId: string; expectedFromOffset: number; toOffset: number };
      releaseTranscriptRange(p.sessionId, p.expectedFromOffset, p.toOffset);
      return undefined;
    }
    case 'getTranscriptCheckpoint':
      return getTranscriptCheckpoint(payload as string);
    case 'listTranscriptCheckpoints':
      return listTranscriptCheckpoints(payload as number | undefined);
  }
}

parentPort?.on('message', (message: CheckpointRequest) => {
  try {
    const result = runOperation(message.operation, message.payload);
    parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

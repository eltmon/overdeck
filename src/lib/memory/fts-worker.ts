import { parentPort } from 'node:worker_threads';
import {
  closeMemoryFtsDatabasesInProcess,
  getMemoryFtsDatabaseSync,
  runMemoryFtsStatementSync,
  runMemoryFtsTransactionSync,
  type MemoryFtsStatement,
} from './fts-operations.js';

interface MemoryFtsRequest {
  id: number;
  operation: 'initialize' | 'statement' | 'transaction' | 'close';
  projectId?: string;
  statement?: MemoryFtsStatement;
  statements?: MemoryFtsStatement[];
}

function runOperation(message: MemoryFtsRequest): unknown {
  switch (message.operation) {
    case 'initialize':
      getMemoryFtsDatabaseSync(requireProjectId(message));
      return null;
    case 'statement':
      return runMemoryFtsStatementSync(requireProjectId(message), requireStatement(message));
    case 'transaction':
      return runMemoryFtsTransactionSync(requireProjectId(message), message.statements ?? []);
    case 'close':
      closeMemoryFtsDatabasesInProcess();
      return null;
  }
}

function requireProjectId(message: MemoryFtsRequest): string {
  if (!message.projectId) throw new Error('Memory FTS worker request missing projectId');
  return message.projectId;
}

function requireStatement(message: MemoryFtsRequest): MemoryFtsStatement {
  if (!message.statement) throw new Error('Memory FTS worker request missing statement');
  return message.statement;
}

parentPort?.on('message', (message: MemoryFtsRequest) => {
  try {
    const result = runOperation(message);
    parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

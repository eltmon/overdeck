import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

const LOCK_HOST = '127.0.0.1';
const LOCK_PORT_BASE = 40_000;
const LOCK_PORT_COUNT = 20_000;
const SYNC_LOCK_TIMEOUT_MS = 5_000;

export interface ProjectsConfigLockHandle {
  release(): Promise<void>;
}

export interface ProjectsConfigLockHandleSync {
  release(): void;
}

export function projectsConfigLockPort(path: string): number {
  const digest = createHash('sha256').update(resolve(path)).digest();
  return LOCK_PORT_BASE + digest.readUInt16BE(0) % LOCK_PORT_COUNT;
}

function lockUnavailable(path: string): Error {
  return new Error(`projects.yaml is already being modified: ${path}`);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

export async function acquireProjectsConfigLock(path: string): Promise<ProjectsConfigLockHandle> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(error.code === 'EADDRINUSE' ? lockUnavailable(path) : error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: LOCK_HOST, port: projectsConfigLockPort(path), exclusive: true });
  });

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await closeServer(server);
    },
  };
}

export function acquireProjectsConfigLockSync(path: string): ProjectsConfigLockHandleSync {
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
  const worker = new Worker(
    `const { createServer } = require('node:net');\n` +
    `const { parentPort, workerData } = require('node:worker_threads');\n` +
    `const state = new Int32Array(workerData.state);\n` +
    `const server = createServer();\n` +
    `server.once('error', () => { Atomics.store(state, 0, -1); Atomics.notify(state, 0); });\n` +
    `server.listen({ host: workerData.host, port: workerData.port, exclusive: true }, () => {\n` +
    `  Atomics.store(state, 0, 1); Atomics.notify(state, 0);\n` +
    `});\n` +
    `parentPort.once('message', () => {\n` +
    `  server.close(() => { Atomics.store(state, 1, 1); Atomics.notify(state, 1); });\n` +
    `});`,
    {
      eval: true,
      workerData: {
        host: LOCK_HOST,
        port: projectsConfigLockPort(path),
        state: state.buffer,
      },
    },
  );

  const acquired = Atomics.wait(state, 0, 0, SYNC_LOCK_TIMEOUT_MS);
  if (acquired === 'timed-out' || Atomics.load(state, 0) !== 1) {
    void worker.terminate();
    throw lockUnavailable(path);
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      worker.postMessage('close');
      const closed = Atomics.wait(state, 1, 0, SYNC_LOCK_TIMEOUT_MS);
      if (closed === 'timed-out') {
        void worker.terminate();
        throw new Error(`Timed out releasing projects.yaml lock: ${path}`);
      }
    },
  };
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ITurnEmitter {
  onPartial(cb: (text: string) => void): void;
  onCommitted(cb: (text: string) => void): void;
  onError(cb: (error: Error) => void): void;
  sendAudio(pcm: Buffer): void;
  stop(): void;
  close(): void;
}

type SidecarMessage =
  | { type: 'ready' }
  | { type: 'transcript:partial'; text: string }
  | { type: 'transcript:committed'; text: string }
  | { type: 'error'; error: string };

const SAMPLE_RATE = 24000;

function resolveSidecarBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../packages/moonshine-linux-x64/bin/moonshine-sidecar'),
    resolve(process.cwd(), 'packages/moonshine-linux-x64/bin/moonshine-sidecar'),
    resolve(process.cwd(), 'node_modules/moonshine-linux-x64/bin/moonshine-sidecar'),
  ];
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error(`Moonshine sidecar binary not found. Run npm run build:sidecar to create ${candidates[0]}`);
  }
  return binary;
}

class MoonshineTranscription implements ITurnEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly partialCallbacks = new Set<(text: string) => void>();
  private readonly committedCallbacks = new Set<(text: string) => void>();
  private readonly errorCallbacks = new Set<(error: Error) => void>();
  private stdoutBuffer = '';
  private closed = false;
  private stopping = false;

  constructor(modelSize: string) {
    this.child = spawn(resolveSidecarBinary(), [], {
      env: {
        ...process.env,
        MOONSHINE_MODEL: modelSize,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => this.emitError(new Error(String(chunk).trim())));
    this.child.on('error', (error) => this.emitError(error));
    this.child.on('exit', (code, signal) => {
      if (!this.closed && !this.stopping) {
        this.emitError(new Error(`Moonshine sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      }
    });
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCallbacks.add(cb);
  }

  onCommitted(cb: (text: string) => void): void {
    this.committedCallbacks.add(cb);
  }

  onError(cb: (error: Error) => void): void {
    this.errorCallbacks.add(cb);
  }

  sendAudio(pcm: Buffer): void {
    this.writeJson({
      type: 'audio',
      encoding: 'pcm16le',
      sampleRate: SAMPLE_RATE,
      audio: pcm.toString('base64'),
    });
  }

  stop(): void {
    this.stopping = true;
    this.writeJson({ type: 'stop' });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writeJson({ type: 'close' });
    this.child.kill('SIGTERM');
    this.partialCallbacks.clear();
    this.committedCallbacks.clear();
    this.errorCallbacks.clear();
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleMessage(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleMessage(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (message.type === 'transcript:partial') {
      for (const cb of this.partialCallbacks) cb(message.text);
    } else if (message.type === 'transcript:committed') {
      for (const cb of this.committedCallbacks) cb(message.text);
    } else if (message.type === 'error') {
      this.emitError(new Error(message.error));
    }
  }

  private writeJson(message: Record<string, unknown>): void {
    if (this.closed || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) cb(error);
  }
}

export function createMoonshineTranscription(modelSize: string): ITurnEmitter {
  return new MoonshineTranscription(modelSize);
}

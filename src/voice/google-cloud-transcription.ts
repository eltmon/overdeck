import { PassThrough } from 'node:stream';
import type { ITurnEmitter } from './transcription.js';

const SAMPLE_RATE = 24000;
const MAX_BACKEND_AUDIO_BUFFER_BYTES = 1_000_000;

type GoogleStreamingRecognizeResponse = {
  results?: Array<{
    isFinal?: boolean;
    alternatives?: Array<{ transcript?: string }>;
  }>;
};

class GoogleCloudTranscription implements ITurnEmitter {
  private readonly partialCallbacks = new Set<(text: string) => void>();
  private readonly committedCallbacks = new Set<(text: string) => void>();
  private readonly errorCallbacks = new Set<(error: Error) => void>();
  private readonly audio = new PassThrough();
  private readonly pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private stream: NodeJS.WritableStream | null = null;
  private closed = false;
  private stopRequested = false;

  constructor(apiKey: string, model: string) {
    if (!apiKey.trim()) {
      throw new Error('Google Cloud STT API key is required');
    }
    this.start(apiKey, model);
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

  sendAudio(pcm: Buffer): boolean {
    if (this.closed || this.stopRequested) return false;
    if (!this.stream) {
      if (this.pendingAudioBytes + pcm.byteLength > MAX_BACKEND_AUDIO_BUFFER_BYTES) return false;
      this.pendingAudio.push(Buffer.from(pcm));
      this.pendingAudioBytes += pcm.byteLength;
      return true;
    }
    if (this.audio.writableLength + pcm.byteLength > MAX_BACKEND_AUDIO_BUFFER_BYTES) return false;
    return this.audio.write(pcm);
  }

  stop(): void {
    this.stopRequested = true;
    if (this.stream) {
      this.audio.end();
      this.stream = null;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingAudio.length = 0;
    this.pendingAudioBytes = 0;
    this.stream?.end();
    this.audio.end();
    this.partialCallbacks.clear();
    this.committedCallbacks.clear();
    this.errorCallbacks.clear();
  }

  private async start(apiKey: string, model: string): Promise<void> {
    try {
      const { SpeechClient } = await import('@google-cloud/speech').then((module) => module.v1p1beta1 ?? module.v1);
      if (this.closed) return;
      const client = new SpeechClient({ apiKey });
      const stream = client
        .streamingRecognize({
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: SAMPLE_RATE,
            languageCode: 'en-US',
            model,
            enableAutomaticPunctuation: true,
          },
          interimResults: true,
          singleUtterance: false,
        })
        .on('error', (error: Error) => this.emitError(error))
        .on('data', (response: GoogleStreamingRecognizeResponse) => this.handleResponse(response));
      this.stream = stream;
      this.audio.pipe(stream);
      for (const pending of this.pendingAudio.splice(0)) {
        this.audio.write(pending);
      }
      this.pendingAudioBytes = 0;
      if (this.stopRequested) this.stop();
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleResponse(response: GoogleStreamingRecognizeResponse): void {
    for (const result of response.results ?? []) {
      const text = result.alternatives?.[0]?.transcript?.trim();
      if (!text) continue;
      const callbacks = result.isFinal ? this.committedCallbacks : this.partialCallbacks;
      for (const cb of callbacks) cb(text);
    }
  }

  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) cb(error);
  }
}

export function createGoogleCloudTranscription(apiKey: string, model: string): ITurnEmitter {
  return new GoogleCloudTranscription(apiKey, model);
}

import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createGoogleCloudTranscription } from '../../src/voice/google-cloud-transcription.js';

const googleMocks = vi.hoisted(() => ({
  streamingRecognize: vi.fn(),
}));

vi.mock('@google-cloud/speech', () => ({
  v1p1beta1: {
    SpeechClient: class SpeechClient {
      streamingRecognize = googleMocks.streamingRecognize;
    },
  },
}));

describe('createGoogleCloudTranscription', () => {
  it('buffers early audio until the Google stream is ready', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    googleMocks.streamingRecognize.mockReturnValueOnce(stream);

    const emitter = createGoogleCloudTranscription('api-key', 'latest_long');
    expect(emitter.sendAudio(Buffer.from('early'))).toBe(true);

    await vi.waitFor(() => expect(googleMocks.streamingRecognize).toHaveBeenCalled());
    await vi.waitFor(() => expect(Buffer.concat(chunks).toString()).toBe('early'));
    emitter.close();
  });

  it('reports backpressure when the pre-ready audio buffer is full', () => {
    const emitter = createGoogleCloudTranscription('api-key', 'latest_long');
    expect(emitter.sendAudio(Buffer.alloc(1_000_000))).toBe(true);
    expect(emitter.sendAudio(Buffer.alloc(1))).toBe(false);
    emitter.close();
  });

  it.skipIf(!process.env.GOOGLE_CLOUD_SPEECH_API_KEY)(
    'returns an ITurnEmitter for Google Cloud streaming recognition',
    () => {
      const emitter = createGoogleCloudTranscription(
        process.env.GOOGLE_CLOUD_SPEECH_API_KEY!,
        'latest_long'
      );

      expect(emitter).toMatchObject({
        onPartial: expect.any(Function),
        onCommitted: expect.any(Function),
        onError: expect.any(Function),
        sendAudio: expect.any(Function),
        stop: expect.any(Function),
        close: expect.any(Function),
      });
      emitter.close();
    }
  );
});

import { describe, expect, it } from 'vitest';
import { createGoogleCloudTranscription } from '../../src/voice/google-cloud-transcription.js';

describe('createGoogleCloudTranscription', () => {
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

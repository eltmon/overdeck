import { describe, expect, it } from 'vitest';
import { stripProjectTtsEndpoint } from '../tts-runtime-config.js';


describe('stripProjectTtsEndpoint', () => {
  it('removes daemon endpoint overrides from project TTS config', () => {
    expect(stripProjectTtsEndpoint({
      tts: {
        enabled: true,
        voice: 'voice-main',
        daemonHost: '169.254.169.254',
        daemonPort: 80,
      },
    })).toEqual({
      tts: {
        enabled: true,
        voice: 'voice-main',
      },
    });
  });
});

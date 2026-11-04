/** PAN-4482 WI-4: LoopbackViewer passes its optional ICE configuration to werift. */
import { describe, expect, it } from 'vitest';
import { LoopbackViewer } from './loopback-viewer.js';

describe('LoopbackViewer configuration (PAN-4482 WI-4)', () => {
  it('defaults to no ICE servers and the all policy', async () => {
    const viewer = new LoopbackViewer();
    try {
      expect(viewer.pc.config.iceServers).toEqual([]);
      expect(viewer.pc.config.iceTransportPolicy).toBe('all');
    } finally {
      await viewer.close();
    }
  });

  it('passes ICE servers and the relay policy to werift', async () => {
    const iceServers = [{ urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'u', credential: 'c' }];
    const viewer = new LoopbackViewer({ iceServers, iceTransportPolicy: 'relay' });
    try {
      expect(viewer.pc.config.iceServers).toEqual(iceServers);
      expect(viewer.pc.config.iceTransportPolicy).toBe('relay');
    } finally {
      await viewer.close();
    }
  });
});

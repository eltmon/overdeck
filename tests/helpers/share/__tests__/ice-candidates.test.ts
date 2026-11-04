/** PAN-4482 WI-5: the relay-candidate classifier. */
import { describe, expect, it } from 'vitest';
import { candidateType, signaledCandidates } from '../ice-candidates.js';

describe('ICE candidate classifier (PAN-4482 WI-5)', () => {
  it('reads the typ of a candidate string', () => {
    expect(candidateType('candidate:1 1 udp 2130706431 192.168.1.2 50000 typ host')).toBe('host');
    expect(candidateType('candidate:2 1 udp 1694498815 203.0.113.7 50001 typ srflx raddr 0.0.0.0 rport 0')).toBe('srflx');
    expect(candidateType('candidate:3 1 udp 16777215 198.51.100.9 50002 typ relay raddr 1.2.3.4 rport 5')).toBe('relay');
    expect(candidateType('candidate:4 1 udp 2130706431 192.168.1.2 50003')).toBe('unknown');
  });

  it('collects candidates from candidate signals and from SDP lines', () => {
    const sdp = [
      'v=0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'a=candidate:1 1 udp 16777215 198.51.100.9 50002 typ relay raddr 1.2.3.4 rport 5',
      'a=candidate:2 1 udp 2130706431 192.168.1.2 50000 typ host',
      '',
    ].join('\r\n');
    expect(
      signaledCandidates([
        { sdp: { type: 'offer', sdp } },
        { candidate: { candidate: 'candidate:3 1 udp 16777215 198.51.100.9 50004 typ relay raddr 1.2.3.4 rport 6', sdpMid: '0', sdpMLineIndex: 0 } },
      ]),
    ).toEqual([
      { type: 'relay', source: 'sdp' },
      { type: 'host', source: 'sdp' },
      { type: 'relay', source: 'candidate' },
    ]);
    expect(signaledCandidates([{ candidate: { candidate: '', sdpMid: '0', sdpMLineIndex: 0 } }])).toEqual([]);
  });
});

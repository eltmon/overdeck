import { describe, expect, it } from 'vitest';
import type { HostFrame, ShareScope, ViewerFrame } from '@overdeck/contracts';
import {
  decodeHostFrame,
  decodeViewerFrame,
  MAX_CANDIDATE_CHARS,
  MAX_FRAME_CHARS,
  MAX_SDP_CHARS,
} from '../../../../services/share/src/protocol.ts';

const offer = { sdp: { type: 'offer', sdp: 'v=0\r\n' } } as const;
const ice = { candidate: { candidate: 'candidate:1 1 udp 2122260223 10.0.0.1 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 } } as const;

function host(frame: unknown) {
  return decodeHostFrame(JSON.stringify(frame));
}
function viewer(frame: unknown) {
  return decodeViewerFrame(JSON.stringify(frame));
}

describe('share protocol contracts (PAN-658 share-protocol)', () => {
  it('@overdeck/contracts exports the sharing types', () => {
    const scope: ShareScope = { kind: 'conversation', conversationId: 'c1' };
    const frame: HostFrame = { type: 'end' };
    const leave: ViewerFrame = { type: 'leave' };
    expect([scope.kind, frame.type, leave.type]).toEqual(['conversation', 'end', 'leave']);
  });
});

describe('decodeHostFrame', () => {
  it('decodes every HostFrame union member', () => {
    const frames: HostFrame[] = [
      { type: 'admit', githubId: 7 },
      { type: 'admit', githubId: 7, contributor: true },
      { type: 'kick', githubId: 7 },
      { type: 'revoke', githubId: 7 },
      { type: 'unrevoke', githubId: 7 },
      { type: 'set-contributor', githubId: 7, contributor: false },
      { type: 'set-controller', githubId: 7 },
      { type: 'signal', githubId: 7, data: offer },
      { type: 'signal', githubId: 7, data: ice },
      { type: 'signal', githubId: 7, data: { ...offer, ...ice } },
      { type: 'ice-servers' },
      { type: 'end' },
    ];
    for (const frame of frames) expect(host(frame)).toEqual({ ok: true, frame });
  });

  it('drops unknown extra keys at every level', () => {
    const result = host({ type: 'admit', githubId: 7, contributor: true, extra: 'x' });
    expect(result).toEqual({ ok: true, frame: { type: 'admit', githubId: 7, contributor: true } });
    if (result.ok) expect('extra' in result.frame).toBe(false);

    const signal = host({
      type: 'signal',
      githubId: 7,
      data: { sdp: { type: 'answer', sdp: 'x', junk: 1 }, junk: 2 },
    });
    expect(signal).toEqual({ ok: true, frame: { type: 'signal', githubId: 7, data: { sdp: { type: 'answer', sdp: 'x' } } } });

    const proto = decodeHostFrame('{"type":"end","__proto__":{"polluted":true}}');
    expect(proto).toEqual({ ok: true, frame: { type: 'end' } });
    if (proto.ok) expect(Object.keys(proto.frame)).toEqual(['type']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a githubId that is not a positive safe integer', () => {
    for (const githubId of [1.5, -1, 0, '7', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(host({ type: 'kick', githubId })).toEqual({ ok: false, code: 'invalid_frame' });
    }
    expect(host({ type: 'kick' })).toEqual({ ok: false, code: 'invalid_frame' });
  });

  it('rejects fields of the wrong primitive type', () => {
    expect(host({ type: 'admit', githubId: 7, contributor: 'yes' })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(host({ type: 'set-contributor', githubId: 7 })).toEqual({ ok: false, code: 'invalid_frame' });
  });

  it('rejects an unknown or missing type', () => {
    expect(host({ type: 'nuke', githubId: 7 })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(host({ type: 'leave' })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(host({ githubId: 7 })).toEqual({ ok: false, code: 'invalid_frame' });
  });

  it('rejects a signal without sdp or candidate, or with malformed signal data', () => {
    const bad: unknown[] = [
      {},
      null,
      [offer],
      { sdp: { type: 'pranswer', sdp: 'x' } },
      { sdp: { type: 'offer' } },
      { sdp: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_CHARS + 1) } },
      { candidate: { candidate: 'x'.repeat(MAX_CANDIDATE_CHARS + 1) } },
      { candidate: { candidate: 'x', sdpMid: 3 } },
      { candidate: { candidate: 'x', sdpMLineIndex: -1 } },
      { candidate: { candidate: 'x', sdpMLineIndex: '0' } },
    ];
    for (const data of bad) expect(host({ type: 'signal', githubId: 7, data })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(host({ type: 'signal', githubId: 7 })).toEqual({ ok: false, code: 'invalid_frame' });
  });

  it('accepts the SDP and candidate size limits exactly and null sdpMid/sdpMLineIndex', () => {
    const data = {
      sdp: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_CHARS) },
      candidate: { candidate: 'x'.repeat(MAX_CANDIDATE_CHARS), sdpMid: null, sdpMLineIndex: null },
    };
    expect(host({ type: 'signal', githubId: 7, data })).toEqual({ ok: true, frame: { type: 'signal', githubId: 7, data } });
  });
});

describe('decodeViewerFrame', () => {
  it('decodes every ViewerFrame union member and drops extra keys', () => {
    const frames: ViewerFrame[] = [{ type: 'signal', data: offer }, { type: 'ice-servers' }, { type: 'leave' }];
    for (const frame of frames) expect(viewer({ ...frame, githubId: 99, extra: true })).toEqual({ ok: true, frame });
  });

  it('rejects host-only frame types and a signal without sdp or candidate', () => {
    expect(viewer({ type: 'admit', githubId: 7 })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(viewer({ type: 'end' })).toEqual({ ok: false, code: 'invalid_frame' });
    expect(viewer({ type: 'signal', data: {} })).toEqual({ ok: false, code: 'invalid_frame' });
  });
});

describe('frame envelope limits (both decoders)', () => {
  it('a binary frame is invalid_frame', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'end' })).buffer as ArrayBuffer;
    expect(decodeHostFrame(bytes)).toEqual({ ok: false, code: 'invalid_frame' });
    expect(decodeViewerFrame(bytes)).toEqual({ ok: false, code: 'invalid_frame' });
  });

  it('a 65,537-character string is frame_too_large; 65,536 characters is decoded', () => {
    const tooLarge = 'x'.repeat(MAX_FRAME_CHARS + 1);
    expect(tooLarge.length).toBe(65_537);
    expect(decodeHostFrame(tooLarge)).toEqual({ ok: false, code: 'frame_too_large' });
    expect(decodeViewerFrame(tooLarge)).toEqual({ ok: false, code: 'frame_too_large' });

    const prefix = '{"type":"leave","pad":"';
    const exact = prefix + 'x'.repeat(MAX_FRAME_CHARS - prefix.length - 2) + '"}';
    expect(exact.length).toBe(MAX_FRAME_CHARS);
    expect(decodeViewerFrame(exact)).toEqual({ ok: true, frame: { type: 'leave' } });
  });

  it('non-JSON and non-object payloads are invalid_frame', () => {
    for (const raw of ['not json', '"end"', '42', 'null', '[{"type":"end"}]', '']) {
      expect(decodeHostFrame(raw)).toEqual({ ok: false, code: 'invalid_frame' });
      expect(decodeViewerFrame(raw)).toEqual({ ok: false, code: 'invalid_frame' });
    }
  });
});

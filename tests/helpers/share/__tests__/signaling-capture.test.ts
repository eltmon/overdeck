/** PAN-4482 WI-2: the signaling capture and its leak, structure and summary checks; no network. */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ShareSocket } from '../../../../src/dashboard/server/services/share-host.js';
import { findLeaks, frameViolations, SignalingCapture, summarize, type CaptureEntry } from '../signaling-capture.js';

class FakeSocket extends EventEmitter {
  readonly readyState = 1;
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  ping(): void {}
  close(): void {}
  terminate(): void {}
}

const text = (role: 'host' | 'viewer', direction: 'to-service' | 'from-service', frame: unknown): CaptureEntry => ({
  kind: 'ws-text',
  role,
  label: role === 'host' ? 'owner' : 'alice',
  direction,
  text: typeof frame === 'string' ? frame : JSON.stringify(frame),
});

const CANARY = 'PRIVACY-CANARY-DRAFT-0f9c3a52-6c1d-4f0e-9d2b-7a1e5c4b3d21';
const SNAPSHOT = {
  shortCode: 'BCDFGHJK',
  scope: { kind: 'conversation', conversationId: 'conv-1' },
  dataOwner: { githubId: 1, login: 'owner', avatarUrl: '' },
  controllerGithubId: 1,
  hostConnected: true,
  participants: [],
  blocked: [],
};
const OFFER = { sdp: { type: 'offer', sdp: 'v=0' } };
const ANSWER = { sdp: { type: 'answer', sdp: 'v=0' } };
const CANDIDATE = { candidate: { candidate: 'candidate:1 1 udp 2 1.2.3.4 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 } };

describe('SignalingCapture (PAN-4482 WI-2)', () => {
  it('records sends and messages in both directions without changing the socket', () => {
    const capture = new SignalingCapture();
    const fake = new FakeSocket();
    const open = capture.openSocket('viewer', 'bob', () => fake as unknown as ShareSocket);
    const socket = open('ws://share.test/v1/rooms/BCDFGHJK/join?v=1', { Authorization: 'Bearer x' });
    expect(socket).toBe(fake);

    socket.send('{"type":"leave"}');
    expect(fake.sent).toEqual(['{"type":"leave"}']);

    fake.emit('message', Buffer.from('{"type":"status","status":"lobby"}'), false);
    fake.emit('message', Buffer.from([1, 2, 3]), true);
    fake.emit('close', 4004, Buffer.from(''));

    expect(capture.entries).toEqual([
      { kind: 'ws-text', role: 'viewer', label: 'bob', direction: 'to-service', text: '{"type":"leave"}' },
      { kind: 'ws-text', role: 'viewer', label: 'bob', direction: 'from-service', text: '{"type":"status","status":"lobby"}' },
      { kind: 'ws-binary', role: 'viewer', label: 'bob', direction: 'from-service', bytes: 3 },
      { kind: 'ws-close', role: 'viewer', label: 'bob', code: 4004 },
    ]);
    expect(capture.framesFor('bob', 'from-service')).toEqual([{ type: 'status', status: 'lobby' }]);
  });

  it('findLeaks reports a planted canary in plain, case-folded and base64 form, and nothing for clean traffic', () => {
    const plain = text('host', 'to-service', { type: 'signal', githubId: 100, data: { sdp: { type: 'offer', sdp: `v=0 ${CANARY}` } } });
    const folded = text('viewer', 'to-service', { type: 'signal', data: { sdp: { type: 'answer', sdp: CANARY.toLowerCase() } } });
    const base64 = text('viewer', 'from-service', { type: 'signal', data: { sdp: { type: 'offer', sdp: Buffer.from('ab' + CANARY).toString('base64') } } });
    const leaks = findLeaks([plain, folded, base64], [CANARY]);
    expect(leaks.map((l) => l.form)).toEqual(['plain', 'case-folded', 'base64']);
    expect(leaks.map((l) => l.where)).toEqual([
      'entry #0 ws-text host/owner to-service',
      'entry #1 ws-text viewer/alice to-service',
      'entry #2 ws-text viewer/alice from-service',
    ]);
    for (const leak of leaks) expect(leak.where).not.toContain(CANARY);

    const http: CaptureEntry = { kind: 'http', method: 'POST', path: '/v1/rooms', status: 201, requestBody: '{}', responseBody: CANARY };
    expect(findLeaks([http], [CANARY])).toEqual([{ canary: CANARY, form: 'plain', where: 'entry #0 http POST /v1/rooms response' }]);

    const clean = [text('host', 'to-service', { type: 'signal', githubId: 100, data: OFFER }), text('host', 'from-service', { type: 'room', snapshot: SNAPSHOT })];
    expect(findLeaks(clean, [CANARY])).toEqual([]);
  });

  it('frameViolations accepts every documented frame and rejects unknown types, extra keys and binary', () => {
    const valid: CaptureEntry[] = [
      text('host', 'to-service', { type: 'admit', githubId: 100, contributor: true }),
      text('host', 'to-service', { type: 'kick', githubId: 100 }),
      text('host', 'to-service', { type: 'revoke', githubId: 100 }),
      text('host', 'to-service', { type: 'unrevoke', githubId: 100 }),
      text('host', 'to-service', { type: 'set-controller', githubId: 100 }),
      text('host', 'to-service', { type: 'set-contributor', githubId: 100, contributor: false }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: OFFER }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: CANDIDATE }),
      text('host', 'to-service', { type: 'ice-servers' }),
      text('host', 'to-service', { type: 'end' }),
      text('host', 'from-service', { type: 'room', snapshot: SNAPSHOT }),
      text('host', 'from-service', { type: 'signal', githubId: 100, data: ANSWER }),
      text('host', 'from-service', { type: 'ice-servers', iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }),
      text('host', 'from-service', { type: 'error', code: 'unknown_participant', githubId: 100 }),
      text('viewer', 'to-service', { type: 'signal', data: ANSWER }),
      text('viewer', 'to-service', { type: 'ice-servers' }),
      text('viewer', 'to-service', { type: 'leave' }),
      text('viewer', 'to-service', 'ping'),
      text('viewer', 'from-service', { type: 'status', status: 'admitted', contributor: true }),
      text('viewer', 'from-service', { type: 'signal', data: CANDIDATE }),
      text('viewer', 'from-service', { type: 'ice-servers', iceServers: [] }),
      text('viewer', 'from-service', { type: 'error', code: 'not_admitted' }),
      text('viewer', 'from-service', 'pong'),
      { kind: 'ws-close', role: 'viewer', label: 'alice', code: 4004 },
      { kind: 'http', method: 'POST', path: '/v1/rooms', status: 201, requestBody: '{}', responseBody: '{}' },
    ];
    expect(frameViolations(valid)).toEqual([]);

    const invalid: CaptureEntry[] = [
      text('host', 'to-service', { type: 'chat', text: 'x' }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: { content: 'x' } }),
      text('host', 'from-service', { type: 'room', snapshot: { ...SNAPSHOT, messages: [] } }),
      text('viewer', 'to-service', { type: 'admit', githubId: 100 }),
      text('viewer', 'to-service', 'hello'),
      { kind: 'ws-binary', role: 'host', label: 'owner', direction: 'from-service', bytes: 4 },
    ];
    for (const entry of invalid) expect(frameViolations([entry])).toHaveLength(1);
    expect(frameViolations(invalid).map((v) => v.problem)).toEqual([
      'type "chat" is not allowed for host to-service',
      'signal data has unknown key "content"',
      'room snapshot has unknown key "messages"',
      'type "admit" is not allowed for viewer to-service',
      'not a JSON frame with a string type',
      'binary frame',
    ]);
  });

  it('summarize counts offers, answers, candidates, snapshots and HTTP calls', () => {
    const entries: CaptureEntry[] = [
      { kind: 'http', method: 'POST', path: '/v1/rooms', status: 201, requestBody: '{}', responseBody: '{}' },
      text('host', 'from-service', { type: 'room', snapshot: SNAPSHOT }),
      text('host', 'from-service', { type: 'room', snapshot: SNAPSHOT }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: OFFER }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: CANDIDATE }),
      text('host', 'to-service', { type: 'signal', githubId: 100, data: CANDIDATE }),
      text('viewer', 'from-service', { type: 'signal', data: OFFER }),
      text('viewer', 'to-service', { type: 'signal', data: ANSWER }),
      text('viewer', 'to-service', { type: 'signal', data: CANDIDATE }),
      text('viewer', 'to-service', 'ping'),
      { kind: 'http', method: 'DELETE', path: '/v1/rooms/BCDFGHJK', status: 204, requestBody: '', responseBody: '' },
    ];
    expect(summarize(entries)).toEqual({ offers: 1, answers: 1, hostCandidates: 2, viewerCandidates: 1, roomSnapshots: 2, posts: 1, deletes: 1 });
  });
});

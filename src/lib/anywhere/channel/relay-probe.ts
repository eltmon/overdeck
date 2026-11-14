/**
 * The relay check (PAN-5242 FR-6): can this machine gather a TURN relay candidate now? One
 * relay-policy werift peer connection, one data channel, one offer; the gather ends inside
 * `setLocalDescription`. Nothing is dialed and no offer leaves this process. No result carries
 * candidate text or credentials.
 */
import { RTCPeerConnection } from 'werift';

import { candidateKind, firstTurnUrl } from './rtc-transport.js';
import { relayIceServers, type RTCIceServerLike } from './relay-ice-servers.js';

export const RELAY_CHECK_TIMEOUT_MS = 12_000;

export type RelayCheckResponse =
  | { state: 'skipped'; reason: 'directory-offline'; detail: string }
  | { state: 'refused'; detail: string }
  | { state: 'unanswered'; detail: string }
  | { state: 'ok'; relayCandidates: number; turnUrl: string; elapsedMs: number }
  | { state: 'failed'; relayCandidates: 0; turnUrl: string | null; elapsedMs: number; detail: string };

export type RelayProbeResult = Extract<RelayCheckResponse, { state: 'ok' } | { state: 'failed' }>;

export interface RelayProbePeer {
  onIceCandidate: { subscribe(handler: (candidate: { toJSON(): { candidate?: string } } | undefined) => void): unknown };
  createDataChannel(label: string, opts: { ordered: boolean }): unknown;
  createOffer(): Promise<unknown>;
  setLocalDescription(description: unknown): Promise<unknown>;
  close(): Promise<void>;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 200);
}

export async function probeRelayCandidate(
  servers: readonly RTCIceServerLike[],
  deps: { createPeer?: (config: { iceServers: RTCIceServerLike[]; iceTransportPolicy: 'relay' }) => RelayProbePeer; now?: () => number; timeoutMs?: number } = {},
): Promise<RelayProbeResult> {
  const ordered = relayIceServers(servers);
  const turnUrl = firstTurnUrl(ordered);
  if (turnUrl === null) {
    return { state: 'failed', relayCandidates: 0, turnUrl: null, elapsedMs: 0, detail: 'the relay list has no TURN server' };
  }

  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? RELAY_CHECK_TIMEOUT_MS;
  const createPeer = deps.createPeer ?? ((config) => new RTCPeerConnection(config) as unknown as RelayProbePeer);
  const started = now();
  const peer = createPeer({ iceServers: ordered, iceTransportPolicy: 'relay' });

  let relayCandidates = 0;
  peer.onIceCandidate.subscribe((candidate) => {
    if (!candidate) return;
    if (candidateKind(candidate.toJSON().candidate ?? '') === 'relay') relayCandidates += 1;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    peer.createDataChannel('ovdl-check', { ordered: true });
    const gather = peer.createOffer().then((offer) => peer.setLocalDescription(offer));
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([gather.then(() => 'gathered' as const), timeout]);
    const elapsedMs = now() - started;
    if (result === 'timeout') return { state: 'failed', relayCandidates: 0, turnUrl, elapsedMs, detail: 'gathering did not finish within 12 s' };
    if (relayCandidates > 0) return { state: 'ok', relayCandidates, turnUrl, elapsedMs };
    return { state: 'failed', relayCandidates: 0, turnUrl, elapsedMs, detail: `gathered no TURN relay candidate from ${turnUrl}` };
  } catch (error) {
    return { state: 'failed', relayCandidates: 0, turnUrl, elapsedMs: now() - started, detail: errorText(error) };
  } finally {
    clearTimeout(timer);
    await peer.close().catch(() => undefined);
  }
}

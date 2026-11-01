/**
 * Linking two machines of one account without a pairing code (PRD PAN-2356 WI-14, D-2356-9).
 *
 * Requester R: `join()` sends `approval-request` through the directory. Its channel listener accepts
 * one approval-mode secure channel for that request id (`takeApproval`), and the channel's SAS and
 * the approver's fingerprint (from the handshake key) appear in `joins[]`. R's operator accepts or
 * rejects; on accept, the approver's `POST /api/machines/approval-exchange` gets R's machine token
 * and R stores its link back with the approver's token.
 *
 * Approver A: incoming `approval-request` frames appear in `approvals[]`. `open()` dials R over a
 * `direct` WebRTC path and runs the approval handshake; the key must equal the one the request
 * named. `approve()` mints A's token for R, posts the exchange until R decides or the request
 * expires, and stores A's link to R. A failure revokes the token A minted.
 *
 * The directory never vouches for a key (D-18): a link exists only when both operators confirmed
 * that their screens show the same code. Links created here are `operator` access both ways.
 */
import { randomBytes } from 'node:crypto';
import {
  type AdvertisedEndpoint,
  APPROVAL_TTL_MS,
  type DirectoryApprovalView,
  type DirectoryJoinView,
  type DirectoryToMachineFrame,
  type MachineToDirectoryFrame,
} from '@overdeck/contracts';

import { revokeAccessToken } from '../../../lib/access-tokens.js';
import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, openChannelOverTransport } from '../../../lib/anywhere/channel/open.js';
import { upsertLink, type UpsertLinkInput } from '../../../lib/anywhere/link-store.js';
import { ensureMachineKey, machineKeyFingerprint } from '../../../lib/anywhere/machine-key.js';
import { mergeAdvertised } from '../../../lib/anywhere/routes.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import type { ChannelMarker } from '../channel-peer.js';
import { notifyLinksChanged } from '../routes/machines.js';
import { currentDirectoryRtc } from './directory-rtc.js';
import { grantMachineLink, type GrantMachineLinkInput, type GrantMachineLinkResult } from './machine-link-grant.js';
import { channelRequest } from './machine-link-service.js';

/** The approver re-posts the exchange this often while the requester has not decided. */
export const EXCHANGE_POLL_MS = 2_000;
export const OPEN_TIMEOUT_MS = 20_000;

export class DirectoryApprovalError extends Error {
  constructor(
    readonly code: 'offline' | 'unknown' | 'expired' | 'not-open' | 'fingerprint-mismatch' | 'busy',
    message: string,
  ) {
    super(message);
    this.name = 'DirectoryApprovalError';
  }
}

export interface ApprovalDirectory {
  send(frame: MachineToDirectoryFrame): boolean;
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void): () => void;
}

export interface ChannelJson {
  status: number;
  json: unknown;
}

export interface ApprovalServiceDeps {
  directory: ApprovalDirectory;
  /** Approver: dial the requester over `direct` and run the approval-mode handshake. */
  openApprovalChannel(peerEnvironmentId: string, requestId: string, signal: AbortSignal): Promise<ChannelSocket>;
  request(channel: ChannelSocket, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ChannelJson>;
  grant(input: GrantMachineLinkInput): Promise<GrantMachineLinkResult>;
  revokeToken(id: string): Promise<unknown>;
  upsertLink(input: UpsertLinkInput): Promise<unknown>;
  notifyLinksChanged(): void;
  identity(): Promise<{ environmentId: string; label: string }>;
  endpoints(): AdvertisedEndpoint[];
  now(): number;
  /** Waits between exchange re-posts; injected so tests drive the 10-minute expiry on a fake clock. */
  sleep?(ms: number): Promise<void>;
}

interface Join {
  requestId: string;
  to: string | null;
  expiresAt: number;
  state: DirectoryJoinView['state'];
  channelTaken: boolean;
  approverKeyHex: string | null;
  sas: string | null;
  /** The exchange answer, kept so a re-post after a lost response gets the same token. */
  granted: { token: string; label: string; environmentId: string } | null;
}

interface Approval {
  requestId: string;
  from: string;
  label: string;
  fingerprint: string;
  publicKeyHex: string;
  expiresAt: number;
  state: DirectoryApprovalView['state'];
  sas: string | null;
  error: string | null;
  channel: ChannelSocket | null;
}

const MAX_LABEL = 200;

type ExchangeBody = { environmentId: string; label: string; reverseToken: string; endpoints: AdvertisedEndpoint[] };

function parseExchangeBody(text: string): ExchangeBody | null {
  let value: unknown;
  try {
    value = JSON.parse(text || 'null');
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.environmentId !== 'string' || body.environmentId === '') return null;
  if (typeof body.label !== 'string' || body.label.trim() === '' || body.label.length > MAX_LABEL) return null;
  if (typeof body.reverseToken !== 'string' || !body.reverseToken.startsWith('odk_')) return null;
  const endpoints = Array.isArray(body.endpoints) ? body.endpoints : [];
  const valid = endpoints.every(
    (e) => typeof e === 'object' && e !== null && ((e as { kind?: unknown }).kind === 'lan' || (e as { kind?: unknown }).kind === 'tailnet') && typeof (e as { url?: unknown }).url === 'string',
  );
  if (!valid) return null;
  return { environmentId: body.environmentId, label: body.label.trim(), reverseToken: body.reverseToken, endpoints: endpoints as AdvertisedEndpoint[] };
}

export class DirectoryApprovalService {
  private readonly joins = new Map<string, Join>();
  private readonly approvals = new Map<string, Approval>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: ApprovalServiceDeps) {
    this.offs.push(
      deps.directory.on('approval-request', (frame) => {
        this.approvals.set(frame.requestId, {
          requestId: frame.requestId,
          from: frame.from,
          label: frame.label,
          fingerprint: frame.fingerprint,
          publicKeyHex: frame.publicKeyHex,
          expiresAt: frame.expiresAt,
          state: 'pending',
          sas: null,
          error: null,
          channel: null,
        });
      }),
      deps.directory.on('approval-cancel', (frame) => {
        const approval = this.approvals.get(frame.requestId);
        if (approval && approval.state !== 'approving') {
          approval.channel?.destroy();
          this.approvals.delete(frame.requestId);
        }
        const join = this.joins.get(frame.requestId);
        if (join && join.state !== 'accepted') join.state = 'rejected';
      }),
      deps.directory.on('error', (frame) => {
        const join = frame.requestId ? this.joins.get(frame.requestId) : undefined;
        if (join && join.state === 'waiting') join.state = 'rejected';
      }),
    );
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off();
    for (const approval of this.approvals.values()) approval.channel?.destroy();
  }

  views(): { approvals: DirectoryApprovalView[]; joins: DirectoryJoinView[] } {
    this.prune();
    return {
      approvals: [...this.approvals.values()].map((a) => ({
        requestId: a.requestId,
        from: a.from,
        label: a.label,
        fingerprint: a.channel ? machineKeyFingerprint(a.channel.channel.remoteKeyHex) : a.fingerprint,
        expiresAt: a.expiresAt,
        sas: a.sas,
        state: a.state,
        error: a.error,
      })),
      joins: [...this.joins.values()].map((j) => ({
        requestId: j.requestId,
        to: j.to,
        expiresAt: j.expiresAt,
        sas: j.sas,
        fingerprint: j.approverKeyHex ? machineKeyFingerprint(j.approverKeyHex) : null,
        state: j.state,
      })),
    };
  }

  private prune(): void {
    const now = this.deps.now();
    for (const [id, join] of this.joins) if (join.expiresAt <= now) this.joins.delete(id);
    for (const [id, approval] of this.approvals) {
      if (approval.expiresAt <= now && approval.state !== 'approving') {
        approval.channel?.destroy();
        this.approvals.delete(id);
      }
    }
  }

  // ── Requester ─────────────────────────────────────────────────────────────

  /** Asks the account's machines (or one of them) to approve this machine. */
  join(to: string | null): string {
    this.prune();
    const requestId = randomBytes(16).toString('hex');
    if (!this.deps.directory.send({ type: 'approval-request', requestId, to })) {
      throw new DirectoryApprovalError('offline', 'Not connected to the overdeck.ai directory');
    }
    this.joins.set(requestId, {
      requestId,
      to,
      expiresAt: this.deps.now() + APPROVAL_TTL_MS,
      state: 'waiting',
      channelTaken: false,
      approverKeyHex: null,
      sas: null,
      granted: null,
    });
    return requestId;
  }

  /** The channel listener asks before running an approval handshake: one channel per live request. */
  takeApproval(requestId: string): boolean {
    this.prune();
    const join = this.joins.get(requestId);
    if (!join || join.channelTaken || join.state !== 'waiting') return false;
    join.channelTaken = true;
    return true;
  }

  /** The channel listener reports the approval channel it accepted, with the SAS. */
  onIncomingChannel(channel: ChannelSocket): void {
    const marker = channel.channel;
    const join = marker.mode === 'approval' && marker.requestId ? this.joins.get(marker.requestId) : undefined;
    if (!join || !marker.approvalSas) {
      channel.destroy();
      return;
    }
    join.approverKeyHex = marker.remoteKeyHex;
    join.sas = marker.approvalSas;
    join.state = 'open';
  }

  accept(requestId: string): void {
    const join = this.liveJoin(requestId);
    if (join.state !== 'open') throw new DirectoryApprovalError('not-open', 'No approver has opened this request yet');
    join.state = 'accepted';
  }

  rejectJoin(requestId: string): void {
    const join = this.liveJoin(requestId);
    join.state = 'rejected';
    this.deps.directory.send({ type: 'approval-cancel', requestId });
  }

  private liveJoin(requestId: string): Join {
    this.prune();
    const join = this.joins.get(requestId);
    if (!join) throw new DirectoryApprovalError('unknown', `No live join request ${requestId}`);
    return join;
  }

  /**
   * `POST /api/machines/approval-exchange` on the requester: 202 while its operator has not
   * decided, 403 on reject or expiry, and on accept this machine's token for the approver.
   */
  async handleExchange(bodyText: string, channel: ChannelMarker | null): Promise<{ status: number; json: unknown }> {
    if (channel?.mode !== 'approval' || !channel.requestId) {
      return { status: 403, json: { error: 'the approval exchange is accepted only inside an approval channel' } };
    }
    this.prune();
    const join = this.joins.get(channel.requestId);
    if (!join || join.approverKeyHex !== channel.remoteKeyHex || join.state === 'rejected') {
      return { status: 403, json: { error: 'approval-refused' } };
    }
    if (join.state !== 'accepted') return { status: 202, json: { pending: true } };
    if (!join.granted) {
      const body = parseExchangeBody(bodyText);
      if (!body) return { status: 400, json: { error: 'body must be { environmentId, label, reverseToken, endpoints }' } };
      const self = await this.deps.identity();
      const { token } = await this.deps.grant({
        environmentId: body.environmentId,
        label: body.label,
        peerKeyHex: channel.remoteKeyHex,
        access: 'operator',
        reverse: { token: body.reverseToken, endpoints: body.endpoints },
      });
      join.granted = { token, label: self.label, environmentId: self.environmentId };
    }
    return { status: 200, json: join.granted };
  }

  // ── Approver ──────────────────────────────────────────────────────────────

  private liveApproval(requestId: string): Approval {
    this.prune();
    const approval = this.approvals.get(requestId);
    if (!approval) throw new DirectoryApprovalError('unknown', `No live approval request ${requestId}`);
    return approval;
  }

  /** Opens the approval channel to the requester; its key must be the one the request named. */
  async open(requestId: string): Promise<{ sas: string; fingerprint: string }> {
    const approval = this.liveApproval(requestId);
    if (approval.channel && approval.sas) return { sas: approval.sas, fingerprint: machineKeyFingerprint(approval.channel.channel.remoteKeyHex) };
    if (approval.state !== 'pending') throw new DirectoryApprovalError('busy', 'This approval is already in progress');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
    let channel: ChannelSocket;
    try {
      channel = await this.deps.openApprovalChannel(approval.from, requestId, controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (channel.channel.remoteKeyHex !== approval.publicKeyHex || !channel.channel.approvalSas) {
      channel.destroy();
      throw new DirectoryApprovalError('fingerprint-mismatch', 'The other machine answered with a key the request did not name');
    }
    approval.channel = channel;
    approval.sas = channel.channel.approvalSas;
    approval.state = 'open';
    return { sas: approval.sas, fingerprint: machineKeyFingerprint(channel.channel.remoteKeyHex) };
  }

  /**
   * Mints this machine's token for the requester and runs the exchange in the background. The
   * returned promise settles when the link exists or the approval failed (tests await it; the
   * route does not).
   */
  approve(requestId: string): Promise<void> {
    const approval = this.liveApproval(requestId);
    if (approval.state !== 'open' || !approval.channel) throw new DirectoryApprovalError('not-open', 'Open the approval channel first');
    approval.state = 'approving';
    return this.runApprove(approval, approval.channel);
  }

  private async runApprove(approval: Approval, channel: ChannelSocket): Promise<void> {
    let mintedId: string | null = null;
    try {
      const minted = await this.deps.grant({
        environmentId: approval.from,
        label: approval.label,
        peerKeyHex: approval.publicKeyHex,
        access: 'operator',
      });
      mintedId = minted.record.id;
      const self = await this.deps.identity();
      const body = { environmentId: self.environmentId, label: self.label, reverseToken: minted.token, endpoints: this.deps.endpoints() };
      let answer: ChannelJson;
      for (;;) {
        answer = await this.deps.request(channel, 'POST', '/api/machines/approval-exchange', body);
        if (answer.status !== 202) break;
        if (this.deps.now() >= approval.expiresAt) throw new Error('The other machine did not accept within 10 minutes');
        await (this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(EXCHANGE_POLL_MS);
      }
      if (answer.status !== 200) throw new Error(answer.status === 403 ? 'The other machine rejected the approval' : `approval exchange failed (${answer.status})`);
      const granted = answer.json as { token?: unknown; label?: unknown; environmentId?: unknown };
      if (typeof granted.token !== 'string' || typeof granted.label !== 'string' || granted.environmentId !== approval.from) {
        throw new Error('the approval exchange answered with an unexpected body');
      }
      let endpoints: AdvertisedEndpoint[] = [];
      try {
        const descriptor = await this.deps.request(channel, 'GET', '/api/environment');
        const list = (descriptor.json as { endpoints?: unknown }).endpoints;
        if (descriptor.status === 200 && Array.isArray(list)) endpoints = list as AdvertisedEndpoint[];
      } catch {
        // The link still works through the directory's routes.
      }
      const now = new Date(this.deps.now()).toISOString();
      await this.deps.upsertLink({
        environmentId: approval.from,
        label: granted.label,
        machineKey: approval.publicKeyHex,
        token: granted.token,
        access: 'operator',
        reverseTokenId: mintedId,
        routes: mergeAdvertised([], endpoints, () => now),
      });
      this.deps.notifyLinksChanged();
      this.approvals.delete(approval.requestId);
    } catch (error) {
      if (mintedId) await this.deps.revokeToken(mintedId).catch(() => null);
      approval.state = 'failed';
      approval.error = (error as Error).message;
    } finally {
      channel.destroy();
      approval.channel = null;
    }
  }

  rejectApproval(requestId: string): void {
    const approval = this.liveApproval(requestId);
    approval.channel?.destroy();
    this.approvals.delete(requestId);
    this.deps.directory.send({ type: 'approval-cancel', requestId });
  }
}

/** Production wiring: a `direct` WebRTC path, the real token and link stores. */
export function defaultApprovalDeps(directory: ApprovalDirectory, endpoints: () => AdvertisedEndpoint[]): ApprovalServiceDeps {
  return {
    directory,
    async openApprovalChannel(peerEnvironmentId, requestId, signal) {
      const rtc = currentDirectoryRtc();
      if (!rtc) throw new ChannelOpenError('unreachable', 'Direct connections need an overdeck.ai sign-in');
      const raw = await rtc.transport.dial(peerEnvironmentId, { relay: false, purpose: 'approval', signal });
      return openChannelOverTransport(raw, { mode: 'approval', localKey: await ensureMachineKey(), requestId, signal }, `rtc://${peerEnvironmentId}`);
    },
    request: channelRequest,
    grant: grantMachineLink,
    revokeToken: revokeAccessToken,
    upsertLink,
    notifyLinksChanged,
    identity: ensureEnvironmentIdentity,
    endpoints,
    now: () => Date.now(),
  };
}

let current: DirectoryApprovalService | null = null;

export function setApprovalService(service: DirectoryApprovalService | null): void {
  current = service;
}

export function currentApprovalService(): DirectoryApprovalService | null {
  return current;
}

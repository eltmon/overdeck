// Shared Sessions signaling protocol (PAN-658): the frames the share service exchanges with host and
// viewer servers over its WebSockets, plus the room HTTP API shapes.
//
// Type-only and import-free (D-R3-8): the share Worker imports this file by relative path, so it must
// never pull a runtime dependency into the Worker bundle. The content wire format (PAN-4474, slice 3)
// is at the end of this file; the share service never carries it. Its runtime helpers are in
// `sharing-wire.ts`, which the Worker never imports.
// PAN-4473 (slice 2) adds the host dashboard API types at the end of this file: the shapes the
// browser exchanges with its local dashboard server to create, list and manage shares.
// PAN-4475 (slice 4) adds the viewer dashboard API types at the end: the shapes the viewer browser
// exchanges with its own dashboard server.
// PAN-4476 (slice 5) adds drafts, contributor submits and the queue indicator.

export type ShareProtocolVersion = 1;
export type ShareScope = { readonly kind: 'conversation'; readonly conversationId: string };
// future (PAN-2565 followup): | { readonly kind: 'task'; readonly taskId: string }

export interface ShareIdentity { readonly githubId: number; readonly login: string; readonly avatarUrl: string }
export interface RoomParticipant extends ShareIdentity {
  readonly state: 'lobby' | 'admitted';
  readonly contributor: boolean;
  readonly connected: boolean;
}
export interface RoomSnapshot {
  readonly shortCode: string;
  readonly scope: ShareScope;
  readonly dataOwner: ShareIdentity;
  readonly controllerGithubId: number;
  readonly hostConnected: boolean;
  readonly participants: readonly RoomParticipant[]; // lobby + admitted, oldest first
  readonly blocked: readonly ShareIdentity[];
}
export interface CreateRoomRequest { readonly scope: ShareScope }
export interface CreateRoomResponse { readonly shortCode: string; readonly hostToken: string; readonly joinUrl: string; readonly snapshot: RoomSnapshot }

export interface SignalData {
  readonly sdp?: { readonly type: 'offer' | 'answer'; readonly sdp: string };
  readonly candidate?: { readonly candidate: string; readonly sdpMid?: string | null; readonly sdpMLineIndex?: number | null };
}
export interface IceServer { readonly urls: readonly string[]; readonly username?: string; readonly credential?: string }

export type ShareErrorCode =
  | 'invalid_frame' | 'frame_too_large' | 'not_admitted' | 'unknown_participant'
  | 'room_full' | 'lobby_full' | 'turn_unavailable';

/** Host server → share service (host WebSocket only; D-R3-3). */
export type HostFrame =
  | { readonly type: 'admit'; readonly githubId: number; readonly contributor?: boolean }
  | { readonly type: 'kick'; readonly githubId: number }
  | { readonly type: 'revoke'; readonly githubId: number }
  | { readonly type: 'unrevoke'; readonly githubId: number }
  | { readonly type: 'set-contributor'; readonly githubId: number; readonly contributor: boolean }
  | { readonly type: 'set-controller'; readonly githubId: number } // handoff; dataOwner id = reclaim
  | { readonly type: 'signal'; readonly githubId: number; readonly data: SignalData }
  | { readonly type: 'ice-servers' }
  | { readonly type: 'end' };

/** Share service → host server. */
export type ServiceToHostFrame =
  | { readonly type: 'room'; readonly snapshot: RoomSnapshot }
  | { readonly type: 'signal'; readonly githubId: number; readonly data: SignalData }
  | { readonly type: 'ice-servers'; readonly iceServers: readonly IceServer[] }
  | { readonly type: 'error'; readonly code: ShareErrorCode; readonly githubId?: number };

/** Viewer server → share service. */
export type ViewerFrame =
  | { readonly type: 'signal'; readonly data: SignalData }
  | { readonly type: 'ice-servers' }
  | { readonly type: 'leave' };

export type ViewerStatus = 'lobby' | 'admitted' | 'host-disconnected' | 'host-reconnected';

/** Share service → viewer server. */
export type ServiceToViewerFrame =
  | { readonly type: 'status'; readonly status: ViewerStatus; readonly contributor?: boolean }
  | { readonly type: 'signal'; readonly data: SignalData }
  | { readonly type: 'ice-servers'; readonly iceServers: readonly IceServer[] }
  | { readonly type: 'error'; readonly code: ShareErrorCode };

/** WebSocket close codes the share service uses. */
export type ShareCloseCode =
  | 1000 /* normal: viewer sent leave */
  | 4001 /* unauthorized (never sent post-upgrade; reserved) */
  | 4003 /* blocked: githubId is on the room's block list */
  | 4004 /* room-ended */
  | 4008 /* replaced: same githubId connected again */
  | 4009 /* is-host: viewer githubId equals the data owner */
  | 4010 /* kicked */
  | 4011 /* revoked */
  | 4013 /* room-full or lobby-full */;

// ── Host dashboard API (PAN-4473, slice 2): the browser ⇄ local dashboard server. ──
// The host token never appears in these types (NFR-1).

/** The host socket's state in this dashboard process. A stale record (no socket) is 'disconnected'. */
export type ShareConnection = 'connecting' | 'connected' | 'disconnected';

/** The host frames the browser may request in slice 2. */
export type ShareCommand = Extract<HostFrame, { readonly type: 'admit' | 'kick' | 'revoke' | 'unrevoke' | 'set-contributor' }>;

export interface CreateShareRequest { readonly conversationName: string }

export interface ShareLastError { readonly code: ShareErrorCode | 'replaced'; readonly githubId?: number; readonly at: string }

export interface ShareView {
  readonly shortCode: string;
  readonly joinUrl: string;
  readonly scope: ShareScope;
  readonly createdAt: string;            // ISO
  readonly connection: ShareConnection;
  readonly snapshot: RoomSnapshot | null; // null for a stale record
  readonly lastError: ShareLastError | null;
  /** Slice 5: the viewers' current drafts, oldest started first. Optional so older fixtures compile (D-13). */
  readonly drafts?: readonly ShareDraftView[];
  /** Slice 5: the share's prompt queue. Optional so older fixtures compile (D-13). */
  readonly queue?: ShareQueueView;
}

/** One viewer's current draft, as the host browser sees it. */
export interface ShareDraftView {
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly text: string;
  readonly startedAt: string; // ISO
  readonly updatedAt: string; // ISO
}

/** One prompt waiting in (or being delivered from) the host's queue. */
export interface ShareQueueItemView {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl: string;
  readonly source: 'contributor' | 'controller';
  readonly text: string;
  readonly enqueuedAt: string; // ISO
}

export interface ShareQueueView {
  readonly agentWorking: boolean;
  readonly delivering: boolean;
  readonly items: readonly ShareQueueItemView[];
}

/** POST /api/shares/:code/prompts: a controller send; `draftGithubId` names the picked draft. */
export interface SendSharePromptRequest { readonly text: string; readonly draftGithubId?: number }

export interface ListSharesResponse { readonly shares: readonly ShareView[] }

// ── Content wire format (PAN-4474, slice 3): host server ⇄ viewer over WebRTC data channels. ──
// The share service never carries these. Runtime helpers live in ./sharing-wire.ts.

/** The five data channel labels. Every peer connection carries all five, ordered and reliable. */
export type SharedChannel = 'control' | 'conversation' | 'drafts' | 'terminal' | 'presence';

/** One data-channel message. `v` is 1 in this version; a later host may send more. */
export interface SharedEnvelope<P = unknown> {
  readonly v: number;
  readonly ch: SharedChannel;
  /** The member session; v0: always the shared conversation's name. */
  readonly streamId: string;
  /** Per peer connection, per channel, per stream: 1, 2, 3, … Fragments do not consume one. */
  readonly seq: number;
  /** Host epoch ms. */
  readonly t: number;
  readonly payload: P;
}

/** One piece of an encoded envelope longer than SHARE_MAX_MESSAGE_CHARS, sent in order on the same channel. */
export interface SharedChunk {
  readonly v: number;
  readonly chunk: { readonly id: number; readonly index: number; readonly count: number };
  readonly data: string;
}

/** The first envelope each side sends on `control`. The viewer copies `scope` from the host's hello. */
export interface SharedHello {
  readonly v: number;
  readonly scopeKinds: readonly ShareScope['kind'][];
  readonly scope: ShareScope;
}

export type SharedHelloError = 'invalid_hello' | 'version_unsupported' | 'scope_kind_unsupported';

/** Why a shared prompt was not (or will not be) delivered. */
export type SharedSubmitReason =
  | 'not_contributor' | 'invalid_prompt' | 'too_long' | 'queue_full'
  | 'grant_revoked' | 'delivery_refused' | 'delivery_unknown';

/** `control` payloads. Slice 5 adds submit (viewer → host), submit-ack and draft-sent (host → viewer). */
export type ControlPayload =
  | { readonly kind: 'hello'; readonly hello: SharedHello }
  | { readonly kind: 'error'; readonly code: SharedHelloError }
  | { readonly kind: 'submit'; readonly clientId: string; readonly text: string }
  | {
      readonly kind: 'submit-ack';
      readonly clientId: string;
      readonly status: 'queued' | 'sent' | 'rejected';
      readonly position?: number;           // 1-based, with 'queued'
      readonly reason?: SharedSubmitReason; // with 'rejected'
    }
  | { readonly kind: 'draft-sent' };

/** The allow-listed subset of the internal ChatMessage that may cross to a viewer. */
export interface SharedMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly text: string;
  readonly turnId?: string;
  /** Which human sent a user message (slice 5 sets it; never mapped from ChatMessage). */
  readonly author?: { readonly login: string; readonly avatarUrl: string };
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly streaming?: boolean;
  readonly sequence?: number;
}

/** `conversation` payloads. `history` replaces the stream's whole list. */
export type ConversationPayload =
  | { readonly kind: 'history'; readonly messages: readonly SharedMessage[] }
  | { readonly kind: 'append'; readonly message: SharedMessage }
  | { readonly kind: 'update'; readonly message: SharedMessage }
  | { readonly kind: 'unavailable'; readonly reason: 'transcript_not_found' | 'history_too_large' };

export interface SharedStream {
  readonly streamId: string;
  readonly label: string;
  readonly kind: 'conversation';
  /** Slice 5: the stream's agent is mid-turn. Absent from older hosts. */
  readonly agentWorking?: boolean;
  /** Slice 5: shared prompts waiting in the host's queue. Absent from older hosts. */
  readonly queued?: number;
}

export interface PresenceParticipant {
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly state: 'lobby' | 'admitted';
  readonly contributor: boolean;
  readonly isHost: boolean;
}

/** `presence` payload: the roster (data owner first), the controller and the stream roster. */
export interface PresencePayload {
  readonly controllerGithubId: number;
  readonly participants: readonly PresenceParticipant[];
  readonly streams: readonly SharedStream[];
}

/** Host → viewer on `drafts`: another participant's whole draft; an empty `text` deletes it. */
export interface DraftPayload {
  readonly authorGithubId: number;
  readonly authorLogin: string;
  readonly text: string;
  readonly updatedAt: number;
}

/** Viewer → host on `drafts`: the author's whole draft. The host ignores every other key. */
export interface DraftUpdate { readonly text: string }

// ── Viewer dashboard API (PAN-4475, slice 4): the viewer browser ⇄ its own dashboard server. ──
// The device token never appears in these types.

/** A join's state on the viewer server. Live: connecting, lobby, admitted, host-disconnected. */
export type JoinState =
  | 'connecting' | 'lobby' | 'admitted' | 'host-disconnected'
  | 'away'          // closed by the viewer server's grace timer; POST /api/joins reopens it
  | 'disconnected'  // unexpected close or network error; POST /api/joins reopens it
  | 'left' | 'kicked' | 'revoked' | 'ended' | 'is-host' | 'full' | 'replaced' | 'rejected';

export interface JoinView {
  readonly shortCode: string;
  readonly joinUrl: string;              // <share_url>/s/<shortCode>
  readonly state: JoinState;
  readonly contributor: boolean;
  readonly login: string | null;         // the signed-in GitHub login from account.json
  readonly closeCode: number | null;     // the last join-socket close code, if any
  readonly error: string | null;         // e.g. 'unreachable', 'http_503'; never a token
}

export interface CreateJoinRequest { readonly code: string }
export interface JoinIceServersResponse { readonly iceServers: readonly IceServer[] }

/** Server-sent events on GET /api/joins/:code/events. The SSE `event:` name is `type`. */
export type JoinEvent =
  | { readonly type: 'state'; readonly view: JoinView }
  | { readonly type: 'signal'; readonly data: SignalData }
  | { readonly type: 'replaced' };

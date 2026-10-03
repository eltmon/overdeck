// Shared Sessions signaling protocol (PAN-658): the frames the share service exchanges with host and
// viewer servers over its WebSockets, plus the room HTTP API shapes.
//
// Type-only and import-free (D-R3-8): the share Worker imports this file by relative path, so it must
// never pull a runtime dependency into the Worker bundle. The content wire format (SharedEnvelope and
// friends) is not here: the share service never carries content. Slice 3 (PAN-4474) adds it.

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

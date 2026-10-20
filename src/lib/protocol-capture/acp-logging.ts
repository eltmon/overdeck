/**
 * ACP protocol capture adapter (PAN-4563).
 *
 * effect-acp reports every wire frame through `protocolLogging`. Only
 * `stage: "raw"` events are captured: an outgoing raw payload is one or more
 * NDJSON lines, and an incoming raw payload is a stdout chunk that may hold a
 * partial line or several lines. The sink's per-direction line buffer turns
 * both into one frame per line. Decoded events are ignored.
 */
import * as Effect from 'effect/Effect';
import type { AcpSessionRuntimeOptions } from '../acp/session-runtime.js';
import type { ProtocolCaptureSink } from './capture.js';

export function acpCaptureProtocolLogging(
  sink: ProtocolCaptureSink,
): NonNullable<AcpSessionRuntimeOptions['protocolLogging']> {
  return {
    logIncoming: true,
    logOutgoing: true,
    logger: (event) => event.stage === 'raw' && typeof event.payload === 'string'
      ? Effect.sync(() => sink.recordChunk(event.direction === 'outgoing' ? 'out' : 'in', event.payload as string))
      : Effect.void,
  };
}

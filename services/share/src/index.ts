/**
 * Worker entry for the share service: the ONLY module that imports `cloudflare:workers`.
 * HTTP goes to routes.handle(); each room's Durable Object delegates to RoomHost (room.ts).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { productionDeps } from './env.ts';
import { RoomHost } from './room.ts';
import { handle } from './routes.ts';

/** One instance per room, keyed by short code (`env.ROOMS.idFromName(code)`). */
export class ShareRoom extends DurableObject<Env> {
  private readonly room: RoomHost;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.room = new RoomHost(ctx, env, productionDeps);
  }

  override fetch(req: Request): Promise<Response> {
    return this.room.fetch(req);
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.room.webSocketMessage(ws, message);
  }

  override webSocketClose(ws: WebSocket): Promise<void> {
    return this.room.webSocketClose(ws);
  }

  override webSocketError(ws: WebSocket): Promise<void> {
    return this.room.webSocketError(ws);
  }

  override alarm(): Promise<void> {
    return this.room.alarm();
  }
}

export default {
  fetch(req, env) {
    return handle(req, env, productionDeps);
  },
} satisfies ExportedHandler<Env>;

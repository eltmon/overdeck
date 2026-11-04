/**
 * Worker entry for the connect service: the ONLY module that imports `cloudflare:workers`.
 * HTTP goes to routes.handle(); each account's Durable Object delegates to DirectoryHost (directory.ts).
 */
import { DurableObject } from 'cloudflare:workers';
import { DirectoryHost } from './directory.ts';
import type { Env } from './env.ts';
import { productionDeps } from './env.ts';
import { handle } from './routes.ts';

/** One instance per account, keyed by the account user id (`env.DIRECTORY.idFromName(userId)`). */
export class AccountDirectory extends DurableObject<Env> {
  private readonly host: DirectoryHost;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.host = new DirectoryHost(ctx, env, productionDeps);
  }

  override fetch(req: Request): Promise<Response> {
    return this.host.fetch(req);
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.host.webSocketMessage(ws, message);
  }

  override webSocketClose(ws: WebSocket): Promise<void> {
    return this.host.webSocketClose(ws);
  }

  override webSocketError(ws: WebSocket): Promise<void> {
    return this.host.webSocketError(ws);
  }

  override alarm(): Promise<void> {
    return this.host.alarm();
  }
}

export default {
  fetch(req, env) {
    return handle(req, env, productionDeps);
  },
} satisfies ExportedHandler<Env>;

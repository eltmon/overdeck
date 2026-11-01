/**
 * Worker entry for the connect service: the ONLY module that imports `cloudflare:workers`.
 * HTTP goes to routes.handle(); each account's Durable Object is an `AccountDirectory`.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { productionDeps } from './env.ts';
import { json } from './http.ts';
import { handle } from './routes.ts';

/** One instance per account, keyed by the account user id (`env.DIRECTORY.idFromName(userId)`). */
export class AccountDirectory extends DurableObject<Env> {
  override fetch(_req: Request): Promise<Response> {
    return Promise.resolve(json({ error: 'not_found' }, 404));
  }
}

export default {
  fetch(req, env) {
    return handle(req, env, productionDeps);
  },
} satisfies ExportedHandler<Env>;

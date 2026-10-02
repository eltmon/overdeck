/**
 * Worker entry: the ONLY module that imports `cloudflare:workers` (D-24, NFR-6).
 * It delegates to handle() for HTTP, runMaintenance() for the cron and (from account-device-credentials on)
 * verifyDeviceToken() for the AccountRpc service binding consumed by the hosted vault (PAN-4297).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { productionDeps } from './env.ts';
import { handle } from './routes.ts';
import { runMaintenance } from './maintenance.ts';

export class AccountRpc extends WorkerEntrypoint<Env> {
  /** Scaffold stub; account-device-credentials replaces it with verifyDeviceToken(makeRc(this.env, this.ctx), token). */
  async verifyDevice(_token: string): Promise<{ ok: false; error: 'invalid_token' }> {
    return { ok: false, error: 'invalid_token' };
  }
}

export default {
  fetch(req, env, ctx) {
    return handle(req, env, ctx, productionDeps);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runMaintenance(env, productionDeps));
  },
} satisfies ExportedHandler<Env>;

/**
 * Worker entry: the ONLY module that imports `cloudflare:workers` (D-24, NFR-6).
 * It delegates to handle() for HTTP, runMaintenance() for the cron and (from account-device-credentials on)
 * verifyDeviceToken() for the AccountRpc service binding consumed by the hosted vault (PAN-4297).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { VerifyResult } from './contract.ts';
import { verifyDeviceToken } from './devices.ts';
import type { Env } from './env.ts';
import { productionDeps, rpcContext } from './env.ts';
import { handle } from './routes.ts';
import { runMaintenance } from './maintenance.ts';

/** Service binding consumed by the hosted vault (PAN-4297): `env.ACCOUNT.verifyDevice(token)` (FR-6). */
export class AccountRpc extends WorkerEntrypoint<Env> {
  async verifyDevice(token: string): Promise<VerifyResult> {
    return verifyDeviceToken(rpcContext(this.env, this.ctx, productionDeps), token);
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

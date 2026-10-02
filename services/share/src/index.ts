/**
 * Worker entry for the share service. Once the ShareRoom Durable Object exists, this is the ONLY
 * module that imports `cloudflare:workers`; every other module uses Web APIs only.
 */
import type { Env } from './env.ts';
import { productionDeps } from './env.ts';
import { handle } from './routes.ts';

export default {
  fetch(req, env) {
    return handle(req, env, productionDeps);
  },
} satisfies ExportedHandler<Env>;

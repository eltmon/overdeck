/**
 * GitHub leg callback dispatcher (PRD §7.5, D-21). Scaffold stub; implemented by account-github-leg.
 */
import type { Handler } from './env.ts';
import { notImplemented } from './http.ts';

/** GET /auth/github/callback */
export const handle: Handler = async () => notImplemented();

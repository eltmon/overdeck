/**
 * Admin screen: accounts table, add and revoke (PRD §7.12). Scaffold stubs; implemented by account-admin-grants-screen.
 */
import type { Handler } from '../env.ts';
import { notImplemented } from '../http.ts';

/** GET /admin */
export const page: Handler = async () => notImplemented();
/** POST /admin/grants */
export const addGrant: Handler = async () => notImplemented();
/** POST /admin/grants/:githubId/revoke */
export const revokeGrant: Handler = async () => notImplemented();

/**
 * Admin sign-in and session (PRD §7.12, D-19, D-20). Scaffold stubs; implemented by account-admin-session.
 */
import type { Handler } from '../env.ts';
import { notImplemented } from '../http.ts';

/** POST /admin/login */
export const login: Handler = async () => notImplemented();
/** POST /admin/logout */
export const logout: Handler = async () => notImplemented();

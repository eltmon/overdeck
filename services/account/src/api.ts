/**
 * Device API /v1/* (PRD §7.9). Scaffold stubs; implemented by account-device-api.
 */
import type { Handler } from './env.ts';
import { notImplemented } from './http.ts';

export const me: Handler = async () => notImplemented();
export const listDevices: Handler = async () => notImplemented();
export const renameDevice: Handler = async () => notImplemented();
export const revokeDevice: Handler = async () => notImplemented();

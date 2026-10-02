/**
 * RFC 8628 device flow (PRD §7.7). Scaffold stubs; implemented by account-device-flow.
 */
import type { Handler, RequestContext } from './env.ts';
import { notImplemented } from './http.ts';

/** POST /oauth/device/code */
export const issueCode: Handler = async () => notImplemented();
/** GET /activate */
export const activatePage: Handler = async () => notImplemented();
/** POST /activate */
export const activateSubmit: Handler = async () => notImplemented();
/** POST /activate/confirm */
export const activateConfirm: Handler = async () => notImplemented();

/** POST /oauth/token with grant_type=urn:ietf:params:oauth:grant-type:device_code. */
export async function exchangeDeviceCode(_rc: RequestContext, _form: URLSearchParams): Promise<Response> {
  return notImplemented();
}

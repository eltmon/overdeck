/**
 * POST /oauth/token: parses the form body and dispatches on grant_type (RFC 6749 §4.1.3, RFC 8628 §3.4).
 */
import type { Handler } from './env.ts';
import { json, readForm } from './http.ts';
import { exchangeAuthorizationCode } from './pkce.ts';
import { exchangeDeviceCode } from './device-flow.ts';

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export const handle: Handler = async (req, rc) => {
  const form = await readForm(req);
  if (form === null) {
    return json({ error: 'invalid_request', error_description: 'expected application/x-www-form-urlencoded' }, 400);
  }
  switch (form.get('grant_type')) {
    case 'authorization_code':
      return exchangeAuthorizationCode(rc, form);
    case DEVICE_CODE_GRANT:
      return exchangeDeviceCode(rc, form);
    default:
      return json({ error: 'unsupported_grant_type' }, 400);
  }
};

/** The link a notification tap opens (PAN-4840 FR-6); Android builds it in PushNotice.openLink. */
import { PHONE_PAIR_ENVIRONMENT_ID_RE } from '@overdeck/contracts';

export const NOTIFICATION_LINK_PREFIX = 'ai.overdeck.app:/open#';

export interface NotificationOpen {
  environmentId: string;
  /** `/m` plus its query: the only screens a notification may open. */
  path: string;
}

const BASE = 'https://app.invalid';

/** `ai.overdeck.app:/open#v=1&e=<environmentId>&p=<path>&t=<ts>`, or null when it is not a valid version-1 link. */
export function parseNotificationLink(url: string): NotificationOpen | null {
  if (!url.startsWith(NOTIFICATION_LINK_PREFIX)) return null;
  const params = new URLSearchParams(url.slice(NOTIFICATION_LINK_PREFIX.length));
  const environmentId = params.get('e');
  const p = params.get('p');
  if (params.get('v') !== '1' || params.get('t') === null || p === null) return null;
  if (environmentId === null || !PHONE_PAIR_ENVIRONMENT_ID_RE.test(environmentId)) return null;
  let parsed: URL;
  try {
    parsed = new URL(p, BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== BASE || parsed.pathname !== '/m') return null;
  return { environmentId, path: `/m${parsed.search}` };
}

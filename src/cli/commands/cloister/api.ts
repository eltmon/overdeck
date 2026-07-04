import { getDashboardApiUrlSync } from '../../../lib/config.js';

export async function cloisterApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getDashboardApiUrlSync().replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Dashboard returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

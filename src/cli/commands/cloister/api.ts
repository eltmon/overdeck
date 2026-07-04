import { getDashboardApiUrlSync } from '../../../lib/config.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function cloisterApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getDashboardApiUrlSync().replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `Dashboard returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

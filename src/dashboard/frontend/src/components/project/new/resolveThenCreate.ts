/**
 * One-shot project create for rows that have no form: a suggestion's **Add**,
 * and each repository of a nested batch (PAN-4281 D19).
 *
 * It is the same create core as the form, never a second path: POST
 * `/api/projects/resolve`, stop on findings, else POST `/api/projects`. Only
 * `existing` mode comes through here, and the server answers that
 * synchronously, so there is no clone job to poll.
 */

import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport.js';
import { capture } from '../../../lib/telemetry.js';
import type { CreatedProject, ProjectIntentFinding } from './projectCreateTypes.js';

export type ResolveThenCreateResult = { ok: true; project: CreatedProject } | { ok: false; message: string };

export async function resolveThenCreateProject(body: {
  mode: 'existing';
  path: string;
  name?: string;
  repos?: string[];
}): Promise<ResolveThenCreateResult> {
  try {
    const resolved = await fetchWithTimeout('/api/projects/resolve', {
      method: 'POST',
      credentials: 'include',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!resolved.ok) return { ok: false, message: `HTTP ${resolved.status}` };
    const intent = (await resolved.json()) as { findings?: ProjectIntentFinding[] };
    const finding = intent.findings?.[0];
    if (finding) return { ok: false, message: finding.message };

    const created = await fetchWithTimeout('/api/projects', {
      method: 'POST',
      credentials: 'include',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ ...body, operationId: crypto.randomUUID() }),
    });
    const json = (await created.json().catch(() => ({}))) as {
      key?: string;
      name?: string;
      path?: string;
      error?: string;
      findings?: ProjectIntentFinding[];
    };
    if (!created.ok || !json.key) {
      return { ok: false, message: json.error ?? json.findings?.[0]?.message ?? `HTTP ${created.status}` };
    }
    capture('project_created', { mode: 'existing' });
    return { ok: true, project: { key: json.key, name: json.name ?? json.key, path: json.path ?? body.path } };
  } catch {
    return { ok: false, message: 'Could not reach the server. Try again.' };
  }
}

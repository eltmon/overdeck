/**
 * `GET /api/conversations/:name/preview-ports` (PAN-4650 WI-17, D-4650-17).
 *
 * The dev-server ports a linked machine may want to preview for a
 * conversation: the ports `assignPort` gave the conversation's workspace
 * (`<projectRoot>/.<name>-ports`, the line whose folder is the workspace
 * folder) and the `port` of each service in the project's workspace config.
 * The operator can type any other port; the forward itself enforces the
 * denylist. Scope `read:conversations`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { listProjectsAsync, type ProjectConfig } from '../../../lib/projects.js';
import { canonicalPathAsync, findContainingProjectAsync } from '../../../lib/projects/path-containment.js';
import { jsonResponse } from '../http-helpers.js';

export interface PreviewPort {
  port: number;
  label: string;
}

const PORT_FILE = /^\.(.+)-ports$/;

/** The workspace folder (`workspaces/<folder>/…`) a path lies in, or null for the main checkout. */
function workspaceFolderOf(projectRoot: string, cwd: string): string | null {
  const [first, folder] = relative(projectRoot, cwd).split(sep);
  return first === 'workspaces' && folder ? folder : null;
}

async function assignedPorts(projectRoot: string, folder: string): Promise<PreviewPort[]> {
  let names: string[];
  try {
    names = await readdir(projectRoot);
  } catch {
    return [];
  }
  const ports: PreviewPort[] = [];
  for (const name of names) {
    const label = PORT_FILE.exec(name)?.[1];
    if (!label) continue;
    const lines = (await readFile(join(projectRoot, name), 'utf8').catch(() => '')).split('\n');
    for (const line of lines) {
      const [lineFolder, port] = line.split(':');
      if (lineFolder === folder && Number.isInteger(Number(port))) ports.push({ port: Number(port), label });
    }
  }
  return ports;
}

export async function listPreviewPorts(
  cwd: string,
  projects: Array<{ key: string; config: ProjectConfig }>,
): Promise<PreviewPort[]> {
  const found = await findContainingProjectAsync(Object.fromEntries(projects.map(({ key, config }) => [key, config])), cwd);
  if (!found) return [];
  const [, config] = found;
  const root = await canonicalPathAsync(config.path);
  const folder = workspaceFolderOf(root, await canonicalPathAsync(cwd));
  const ports = folder ? await assignedPorts(root, folder) : [];
  for (const service of config.workspace?.services ?? []) {
    if (typeof service.port === 'number') ports.push({ port: service.port, label: service.name });
  }
  const seen = new Set<number>();
  return ports.filter(({ port }) => !seen.has(port) && seen.add(port)).sort((a, b) => a.port - b.port);
}

const previewPortsRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/preview-ports',
  Effect.gen(function* () {
    const name = decodeURIComponent((yield* HttpRouter.params)['name'] ?? '');
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const ports = yield* Effect.promise(async () => listPreviewPorts(conv.cwd, await listProjectsAsync()));
    return jsonResponse({ ports });
  }),
);

export const conversationPreviewPortsRouteLayer = Layer.mergeAll(previewPortsRoute);

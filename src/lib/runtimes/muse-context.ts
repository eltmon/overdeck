/** Materialize Overdeck-owned context for Muse's developer-message file input. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome, isDevMode } from '../paths.js';
import { findProjectByPathSync } from '../projects.js';
import { renderGlobalLayer, renderProjectLayer } from '../context-layers/render.js';
import { resolveWorkspaceContextFile } from '../context-layers/layers.js';
import { renderForHarness } from '../context-layers/harness.js';
import { workspaceContextWithoutProjectLayer } from '../context-layers/assemble.js';
import { museDataHome } from './muse-session.js';

export async function materializeMuseContext(agentId: string, workspace: string, roleFile?: string): Promise<string> {
  museDataHome(agentId); // Validate identity before forming artifact paths.
  const sections = [renderGlobalLayer('muse', isDevMode())];
  const project = findProjectByPathSync(workspace);
  if (project) sections.push(renderProjectLayer(project.path, 'muse'));
  const workspaceLayer = await readFile(resolveWorkspaceContextFile(workspace), 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  sections.push(renderForHarness(project ? workspaceContextWithoutProjectLayer(workspaceLayer) : workspaceLayer, 'muse'));
  if (roleFile) sections.push(await readFile(roleFile, 'utf8'));
  const dir = join(getOverdeckHome(), 'agents', agentId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'muse-context.md');
  await writeFile(path, sections.filter(section => section.trim()).join('\n\n---\n\n'), { mode: 0o600 });
  return path;
}

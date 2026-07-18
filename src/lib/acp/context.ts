import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { renderForHarness } from '../context-layers/harness.js';
import { workspaceContextFile } from '../context-layers/layers.js';
import { renderGlobalLayer, renderProjectLayer } from '../context-layers/render.js';
import { isDevMode } from '../paths.js';
import { findProjectByPathSync } from '../projects.js';

export function materializeAcpContextFile(
  agentDir: string,
  workspace: string,
): string {
  const sections = [renderGlobalLayer('acp', isDevMode())];
  const project = findProjectByPathSync(workspace);
  if (project) sections.push(renderProjectLayer(project.path, 'acp'));
  const workspaceFile = workspaceContextFile(workspace);
  if (existsSync(workspaceFile)) {
    sections.push(renderForHarness(readFileSync(workspaceFile, 'utf8'), 'acp').trim());
  }

  const content = sections
    .filter((section) => section.trim().length > 0)
    .join('\n\n---\n\n');
  const contextPath = join(agentDir, 'acp-context.md');
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, `${content.trim()}\n`, { mode: 0o600 });
  return contextPath;
}

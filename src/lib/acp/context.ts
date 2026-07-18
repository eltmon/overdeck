import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { workspaceContextWithoutProjectLayer } from '../context-layers/assemble.js';
import { renderForHarness } from '../context-layers/harness.js';
import { resolveWorkspaceContextFile } from '../context-layers/layers.js';
import { renderGlobalLayer, renderProjectLayer } from '../context-layers/render.js';
import { isDevMode } from '../paths.js';
import { findProjectByPathSync } from '../projects.js';

const SECTION_SEPARATOR = '\n\n---\n\n';

export function materializeAcpContextFile(
  agentDir: string,
  workspace: string,
): string {
  const sections = [renderGlobalLayer('acp', isDevMode())];
  const project = findProjectByPathSync(workspace);
  if (project) sections.push(renderProjectLayer(project.path, 'acp'));
  const workspaceFile = resolveWorkspaceContextFile(workspace);
  if (existsSync(workspaceFile)) {
    const workspaceContent = readFileSync(workspaceFile, 'utf8');
    const workspaceOnly = project
      ? workspaceContextWithoutProjectLayer(workspaceContent)
      : workspaceContent;
    sections.push(renderForHarness(workspaceOnly, 'acp').trim());
  }

  const content = sections
    .filter((section) => section.trim().length > 0)
    .join(SECTION_SEPARATOR);
  const contextPath = join(agentDir, 'acp-context.md');
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, `${content.trim()}\n`, { mode: 0o600 });
  return contextPath;
}

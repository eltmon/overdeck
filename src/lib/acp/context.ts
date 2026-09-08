import { join } from 'node:path';

import { materializeManagedLaunchContext } from '../context-layers/materialize.js';

export function materializeAcpContextFile(
  agentDir: string,
  workspace: string,
): string {
  const contextPath = join(agentDir, 'acp-context.md');
  return materializeManagedLaunchContext(contextPath, workspace, 'acp');
}

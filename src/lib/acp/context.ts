import { join } from 'node:path';

import { materializeManagedLaunchContext } from '../context-layers/materialize.js';

export function materializeAcpContextFile(
  agentDir: string,
  workspace: string,
  harness: 'acp' | 'opencode' = 'acp',
): string {
  const contextPath = join(agentDir, 'acp-context.md');
  return materializeManagedLaunchContext(contextPath, workspace, harness);
}

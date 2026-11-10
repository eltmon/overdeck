import { join } from 'node:path';

import { materializeManagedLaunchContext, type ManagedLaunchContextOptions } from '../context-layers/materialize.js';

export function materializeAcpContextFile(
  agentDir: string,
  workspace: string,
  harness: 'acp' | 'opencode' | 'grok' = 'acp',
  opts: ManagedLaunchContextOptions = {},
): string {
  const contextPath = join(agentDir, 'acp-context.md');
  return materializeManagedLaunchContext(contextPath, workspace, harness, opts);
}

/**
 * A recording fake terminal backend (PAN-3960). Register one per name over the
 * real adapters with `registerTerminalBackend` to prove which backend a launch
 * path chose, without touching a real tmux server or Herdr socket.
 */
import { Effect } from 'effect';
import type {
  AgentPaneRef,
  StartAgentSpec,
  TerminalBackend,
  TerminalBackendName,
  WorkspaceRef,
} from '../../src/lib/terminal-backends/types.js';

export interface FakeStartCall {
  readonly workspace: WorkspaceRef;
  readonly spec: StartAgentSpec;
}

export type FakeTerminalBackend = TerminalBackend & { readonly starts: FakeStartCall[] };

export function fakeTerminalBackend(name: TerminalBackendName): FakeTerminalBackend {
  const starts: FakeStartCall[] = [];
  const unsupported = () => Effect.succeed({ unsupported: true as const, reason: 'fake backend' });
  const backend = {
    name,
    starts,
    workspaceFor: (issueId: string, cwd: string) =>
      Effect.succeed({ backend: name, workspaceId: `ws-${issueId}`, issueId, cwd }),
    startAgent: (workspace: WorkspaceRef, spec: StartAgentSpec) => {
      starts.push({ workspace, spec });
      const agentName = spec.name ?? 'unnamed';
      // Like the real adapters: a tmux pane IS the session named after the
      // agent; a Herdr pane has its own handle.
      const paneId = name === 'tmux' ? agentName : `w1:p-${agentName}`;
      const pane: AgentPaneRef = {
        backend: name,
        workspaceId: workspace.workspaceId,
        paneId,
        terminalId: name === 'tmux' ? agentName : `term-${agentName}`,
        agentName,
      };
      return Effect.succeed(pane);
    },
    prompt: unsupported,
    wait: unsupported,
    observe: unsupported,
    control: unsupported,
    list: () => Effect.succeed([]),
    events: unsupported,
    reportMetadata: unsupported,
    close: () => Effect.succeed({ ok: true as const }),
    resume: unsupported,
  };
  return backend as unknown as FakeTerminalBackend;
}

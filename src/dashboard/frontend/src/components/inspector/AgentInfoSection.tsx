import { GitBranch, GitMerge, Folder, Cloud, Monitor, Loader2, ExternalLink } from 'lucide-react';
import { Agent } from '../../types';
import type { WorkspaceInfo } from './types';
import { getFriendlyModelName } from './utils';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';
import { getHarness } from '@panctl/contracts';
import { PanOpenInPicker } from '../PanOpenInPicker';

interface AgentInfoSectionProps {
  agent: Agent;
  duration: string;
  workspace?: WorkspaceInfo;
  syncMainPending: boolean;
  onSyncMain: () => void;
}

void COMMAND_DECK_SURFACE_REGISTRY;

export function AgentInfoSection({ agent, duration, workspace, syncMainPending, onSyncMain }: AgentInfoSectionProps) {
  return (
    <>
      {/* Agent info */}
      <div className="px-3 py-2 border-b border-border text-xs">
        <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Agent</div>
        <div className="space-y-1.5">
          {[
            { label: 'Model', value: getFriendlyModelName(agent.model) },
            { label: 'Runtime', value: getHarness(agent) },
            { label: 'Uptime', value: duration },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-foreground">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Session</span>
            <span className="text-foreground font-mono text-[10px]">{agent.id}</span>
          </div>
        </div>
      </div>

      {/* Git Status */}
      {agent.git && (
        <div className="px-3 py-2 border-b border-border text-xs" data-testid="git-status">
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Git Status</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-foreground">
              <GitBranch className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="font-mono flex-1 truncate">{agent.git.branch}</span>
              <button
                onClick={onSyncMain}
                disabled={syncMainPending}
                title="Sync with main"
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors disabled:opacity-40 bg-card text-muted-foreground"
              >
                {syncMainPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <GitMerge className="w-2.5 h-2.5" />}
                Sync
              </button>
            </div>
            {agent.git.uncommittedFiles > 0 && (
              <div className="text-warning text-[10px] ml-4">{agent.git.uncommittedFiles} uncommitted files</div>
            )}
            <div className="text-[10px] mt-1 truncate text-muted-foreground" title={agent.git.latestCommit}>
              {agent.git.latestCommit}
            </div>
          </div>
        </div>
      )}

      {/* Workspace path (agent view) */}
      {agent.workspace && (
        <div className="px-3 py-2 border-b border-border text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="font-mono truncate text-[10px] flex-1" title={agent.workspace}>
              {agent.workspace}
            </span>
            <a
              href={`vscode://file/${agent.workspace}`}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-card text-primary hover:text-primary/80 border border-border"
              title="Open in VS Code"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              VS Code
            </a>
            <PanOpenInPicker cwd={agent.workspace} />
          </div>
        </div>
      )}

      {/* Workspace path (no-agent view with location badge) */}
      {!agent.workspace && workspace?.exists && workspace.path && (
        <div className="px-3 py-2 border-b border-border text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="font-mono truncate text-[10px]" title={workspace.path}>
              {workspace.path}
            </span>
          </div>
          {workspace.location && (
            <span
              className={`mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${
                workspace.location === 'remote'
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-card text-muted-foreground'
              }`}
            >
              {workspace.location === 'remote' ? <Cloud className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
              {workspace.location}
            </span>
          )}
        </div>
      )}
    </>
  );
}

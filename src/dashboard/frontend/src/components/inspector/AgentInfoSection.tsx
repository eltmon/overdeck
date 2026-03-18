import { GitBranch, GitMerge, Folder, Cloud, Monitor, Loader2 } from 'lucide-react';
import { Agent } from '../../types';

interface WorkspaceInfo {
  exists: boolean;
  path?: string;
  location?: 'local' | 'remote';
}

function getFriendlyModelName(fullModel: string): string {
  if (fullModel.includes('opus-4-6') || fullModel.includes('opus-4.6')) return 'Opus 4.6';
  if (fullModel.includes('opus-4-5') || fullModel.includes('opus-4.5')) return 'Opus 4.5';
  if (fullModel.includes('opus-4-1')) return 'Opus 4.1';
  if (fullModel.includes('opus-4') || fullModel.includes('opus')) return 'Opus 4';
  if (fullModel.includes('sonnet-4-6') || fullModel.includes('sonnet-4.6')) return 'Sonnet 4.6';
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;
}

interface AgentInfoSectionProps {
  agent: Agent;
  duration: string;
  workspace?: WorkspaceInfo;
  syncMainPending: boolean;
  onSyncMain: () => void;
}

export function AgentInfoSection({ agent, duration, workspace, syncMainPending, onSyncMain }: AgentInfoSectionProps) {
  return (
    <>
      {/* Agent info */}
      <div className="px-3 py-2 border-b border-pan-border text-xs">
        <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">Agent</div>
        <div className="space-y-1.5">
          {[
            { label: 'Model', value: getFriendlyModelName(agent.model) },
            { label: 'Runtime', value: agent.runtime },
            { label: 'Uptime', value: duration },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-pan-text-secondary">{label}</span>
              <span className="text-white">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-pan-text-secondary">Session</span>
            <span className="text-white font-mono text-[10px]">{agent.id}</span>
          </div>
        </div>
      </div>

      {/* Git Status */}
      {agent.git && (
        <div className="px-3 py-2 border-b border-pan-border text-xs" data-testid="git-status">
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">Git Status</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-white">
              <GitBranch className="w-3 h-3 shrink-0 text-pan-text-secondary" />
              <span className="font-mono flex-1 truncate">{agent.git.branch}</span>
              <button
                onClick={onSyncMain}
                disabled={syncMainPending}
                title="Sync with main"
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors disabled:opacity-40 bg-pan-border text-pan-text-secondary"
              >
                {syncMainPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <GitMerge className="w-2.5 h-2.5" />}
                Sync
              </button>
            </div>
            {agent.git.uncommittedFiles > 0 && (
              <div className="text-yellow-400 text-[10px] ml-4">{agent.git.uncommittedFiles} uncommitted files</div>
            )}
            <div className="text-[10px] mt-1 truncate text-pan-text-secondary" title={agent.git.latestCommit}>
              {agent.git.latestCommit}
            </div>
          </div>
        </div>
      )}

      {/* Workspace path */}
      {agent.workspace && (
        <div className="px-3 py-2 border-b border-pan-border text-xs">
          <div className="flex items-center gap-1.5 text-pan-text-secondary">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="font-mono truncate text-[10px]" title={agent.workspace}>
              {agent.workspace}
            </span>
          </div>
        </div>
      )}

      {/* Workspace path (no-agent view) */}
      {!agent.workspace && workspace?.exists && workspace.path && (
        <div className="px-3 py-2 border-b border-pan-border text-xs">
          <div className="flex items-center gap-1.5 text-pan-text-secondary">
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
                  : 'bg-pan-border text-pan-text-secondary'
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

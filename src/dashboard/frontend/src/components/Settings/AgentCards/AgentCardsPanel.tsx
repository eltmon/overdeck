import { useMemo } from 'react';
import { AgentCard, AgentPhase } from './AgentCard';
import { WorkTypeId, ModelId } from '../types';

// Agent definitions with their work types
const AGENT_DEFINITIONS = {
  // Main worker agent with phases
  issueAgent: {
    name: 'Issue Agent',
    icon: 'smart_toy',
    description: 'Main worker that handles issues end-to-end',
    phases: [
      { id: 'issue-agent:exploration' as WorkTypeId, name: 'Exploration' },
      { id: 'issue-agent:planning' as WorkTypeId, name: 'Planning' },
      { id: 'issue-agent:implementation' as WorkTypeId, name: 'Implementation' },
      { id: 'issue-agent:testing' as WorkTypeId, name: 'Testing' },
      { id: 'issue-agent:documentation' as WorkTypeId, name: 'Documentation' },
      { id: 'issue-agent:review-response' as WorkTypeId, name: 'Review Response' },
    ],
  },

  // Specialist agents
  reviewAgent: {
    name: 'Review Agent',
    icon: 'rate_review',
    description: 'Comprehensive code review specialist',
    workType: 'specialist-review-agent' as WorkTypeId,
  },
  testAgent: {
    name: 'Test Agent',
    icon: 'bug_report',
    description: 'Test generation and verification',
    workType: 'specialist-test-agent' as WorkTypeId,
  },
  mergeAgent: {
    name: 'Merge Agent',
    icon: 'merge',
    description: 'Merge request finalization',
    workType: 'specialist-merge-agent' as WorkTypeId,
  },

  // Convoy members
  securityReviewer: {
    name: 'Security Reviewer',
    icon: 'shield',
    description: 'Security-focused code review',
    workType: 'convoy:security-reviewer' as WorkTypeId,
  },
  performanceReviewer: {
    name: 'Performance Reviewer',
    icon: 'speed',
    description: 'Performance-focused review',
    workType: 'convoy:performance-reviewer' as WorkTypeId,
  },
  correctnessReviewer: {
    name: 'Correctness Reviewer',
    icon: 'verified',
    description: 'Correctness-focused review',
    workType: 'convoy:correctness-reviewer' as WorkTypeId,
  },
  synthesisAgent: {
    name: 'Synthesis Agent',
    icon: 'hub',
    description: 'Combines reviewer findings',
    workType: 'convoy:synthesis-agent' as WorkTypeId,
  },

  // Subagents
  exploreSubagent: {
    name: 'Explore',
    icon: 'search',
    description: 'Fast codebase exploration',
    workType: 'subagent:explore' as WorkTypeId,
  },
  planSubagent: {
    name: 'Plan',
    icon: 'architecture',
    description: 'Implementation planning',
    workType: 'subagent:plan' as WorkTypeId,
  },
  bashSubagent: {
    name: 'Bash',
    icon: 'terminal',
    description: 'Command execution specialist',
    workType: 'subagent:bash' as WorkTypeId,
  },
  generalSubagent: {
    name: 'General Purpose',
    icon: 'apps',
    description: 'General-purpose tasks',
    workType: 'subagent:general-purpose' as WorkTypeId,
  },

  // Pre-work agents
  prdAgent: {
    name: 'PRD Agent',
    icon: 'description',
    description: 'Product requirement docs',
    workType: 'prd-agent' as WorkTypeId,
  },
  decompositionAgent: {
    name: 'Decomposition Agent',
    icon: 'account_tree',
    description: 'Breaks down work into tasks',
    workType: 'decomposition-agent' as WorkTypeId,
  },
  triageAgent: {
    name: 'Triage Agent',
    icon: 'sort',
    description: 'Prioritizes and triages issues',
    workType: 'triage-agent' as WorkTypeId,
  },
  planningAgent: {
    name: 'Planning Agent',
    icon: 'route',
    description: 'Explores and plans approach',
    workType: 'planning-agent' as WorkTypeId,
  },

  // CLI contexts
  cliInteractive: {
    name: 'CLI Interactive',
    icon: 'chat',
    description: 'Interactive CLI sessions',
    workType: 'cli:interactive' as WorkTypeId,
  },
  cliQuickCommand: {
    name: 'CLI Quick Command',
    icon: 'bolt',
    description: 'Quick one-off commands',
    workType: 'cli:quick-command' as WorkTypeId,
  },
};

// Default model when no override (smart selection)
const DEFAULT_MODEL = 'claude-sonnet-4-5' as ModelId;

interface AgentCardsPanelProps {
  overrides: Partial<Record<WorkTypeId, ModelId>>;
  onConfigureOverride?: (workType: WorkTypeId) => void;
  onRemoveOverride?: (workType: WorkTypeId) => void;
}

export function AgentCardsPanel({
  overrides,
  onConfigureOverride,
  onRemoveOverride,
}: AgentCardsPanelProps) {
  // Helper to get model for a work type
  const getModel = (workType: WorkTypeId): { model: ModelId; isOverride: boolean } => {
    const override = overrides[workType];
    return override
      ? { model: override, isOverride: true }
      : { model: DEFAULT_MODEL, isOverride: false };
  };

  // Build Issue Agent phases
  const issueAgentPhases: AgentPhase[] = useMemo(() => {
    return AGENT_DEFINITIONS.issueAgent.phases.map((phase) => {
      const { model, isOverride } = getModel(phase.id);
      return { ...phase, model, isOverride };
    });
  }, [overrides]);

  // Get primary model for Issue Agent (most common among phases)
  const issueAgentPrimary = useMemo(() => {
    const modelCounts = issueAgentPhases.reduce((acc, phase) => {
      acc[phase.model] = (acc[phase.model] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const [primaryModel] = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0];
    const isOverride = issueAgentPhases.some((p) => p.isOverride);
    return { model: primaryModel as ModelId, isOverride };
  }, [issueAgentPhases]);

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-[#a078f7]">group</span>
          Active Agents
        </h2>
        <p className="text-[#8b7aa0] mt-1">
          Models assigned to each agent. Click to expand phases or configure overrides.
        </p>
      </div>

      {/* Main Worker */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          Main Worker
        </h3>
        <AgentCard
          name={AGENT_DEFINITIONS.issueAgent.name}
          icon={AGENT_DEFINITIONS.issueAgent.icon}
          description={AGENT_DEFINITIONS.issueAgent.description}
          primaryModel={issueAgentPrimary.model}
          isOverride={issueAgentPrimary.isOverride}
          phases={issueAgentPhases}
          onConfigureOverride={onConfigureOverride}
          onRemoveOverride={onRemoveOverride}
        />
      </div>

      {/* Specialist Agents */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          Specialist Agents
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['reviewAgent', 'testAgent', 'mergeAgent'] as const).map((key) => {
            const agent = AGENT_DEFINITIONS[key];
            const { model, isOverride } = getModel(agent.workType);
            return (
              <AgentCard
                key={key}
                name={agent.name}
                icon={agent.icon}
                description={agent.description}
                primaryModel={model}
                isOverride={isOverride}
                variant="compact"
              />
            );
          })}
        </div>
      </div>

      {/* Convoy Review Panel */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          <span className="inline-flex items-center gap-2">
            <span className="material-symbols-outlined text-base">diversity_3</span>
            Convoy (Parallel Review Panel)
          </span>
        </h3>
        <div className="bg-[#1a1625] rounded-xl border border-[#2d2640] p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['securityReviewer', 'performanceReviewer', 'correctnessReviewer', 'synthesisAgent'] as const).map((key) => {
              const agent = AGENT_DEFINITIONS[key];
              const { model, isOverride } = getModel(agent.workType);
              return (
                <div
                  key={key}
                  className="flex flex-col items-center p-3 rounded-lg bg-[#150f1d] border border-[#2d2640]"
                >
                  <span className="material-symbols-outlined text-2xl text-[#a078f7] mb-2">
                    {agent.icon}
                  </span>
                  <span className="text-sm font-medium text-white text-center">{agent.name}</span>
                  <span className="text-xs text-[#8b7aa0] mt-1">{model}</span>
                  {isOverride && (
                    <span className="text-xs text-[#a078f7] mt-1">override</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-center text-xs text-[#6b5a80]">
            Reviewers run in parallel, Synthesis combines findings
          </div>
        </div>
      </div>

      {/* Subagents */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          Subagents
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(['exploreSubagent', 'planSubagent', 'bashSubagent', 'generalSubagent'] as const).map((key) => {
            const agent = AGENT_DEFINITIONS[key];
            const { model, isOverride } = getModel(agent.workType);
            return (
              <AgentCard
                key={key}
                name={agent.name}
                icon={agent.icon}
                description={agent.description}
                primaryModel={model}
                isOverride={isOverride}
                variant="compact"
              />
            );
          })}
        </div>
      </div>

      {/* Pre-work Agents */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          Pre-work Agents
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(['prdAgent', 'decompositionAgent', 'triageAgent', 'planningAgent'] as const).map((key) => {
            const agent = AGENT_DEFINITIONS[key];
            const { model, isOverride } = getModel(agent.workType);
            return (
              <AgentCard
                key={key}
                name={agent.name}
                icon={agent.icon}
                description={agent.description}
                primaryModel={model}
                isOverride={isOverride}
                variant="compact"
              />
            );
          })}
        </div>
      </div>

      {/* CLI Contexts */}
      <div>
        <h3 className="text-sm font-semibold text-[#6b5a80] uppercase tracking-wider mb-3">
          CLI Contexts
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['cliInteractive', 'cliQuickCommand'] as const).map((key) => {
            const agent = AGENT_DEFINITIONS[key];
            const { model, isOverride } = getModel(agent.workType);
            return (
              <AgentCard
                key={key}
                name={agent.name}
                icon={agent.icon}
                description={agent.description}
                primaryModel={model}
                isOverride={isOverride}
                variant="compact"
              />
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="bg-[#150f1d] rounded-lg border border-[#2d2640] p-4 flex items-center justify-between">
        <div className="text-sm text-[#8b7aa0]">
          <span className="text-white font-medium">{Object.keys(overrides).length}</span> custom overrides active
        </div>
        <button
          onClick={() => {
            // Reset all overrides - handled by parent
          }}
          className="text-sm text-[#a078f7] hover:text-white transition-colors"
        >
          Reset all to smart selection
        </button>
      </div>
    </div>
  );
}

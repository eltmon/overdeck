import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, AlertCircle, Sparkles, Play, Terminal, Square, FileText, ExternalLink } from 'lucide-react';
import { Rnd } from 'react-rnd';
import { Issue } from '../types';
import { XTerminal } from './XTerminal';

interface PlanDialogProps {
  issue: Issue;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface StartPlanningResult {
  success: boolean;
  issue: {
    id: string;
    identifier: string;
    title: string;
    newState: string;
  };
  workspace: {
    created: boolean;
    path: string;
    error?: string;
  };
  planningAgent: {
    started: boolean;
    sessionName?: string;
    error?: string;
  };
}

interface PlanningStatus {
  active: boolean;
  sessionName: string;
  workspacePath?: string;
  error?: string;
}

type Step = 'checking' | 'ready' | 'starting' | 'planning' | 'complete' | 'error';

export function PlanDialog({ issue, isOpen, onClose, onComplete }: PlanDialogProps) {
  const [step, setStep] = useState<Step>('checking');
  const [result, setResult] = useState<StartPlanningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 }); // -1 means centered
  const [size, setSize] = useState({ width: 900, height: 600 });
  
  // Track if we've actually connected to a planning session in THIS dialog instance
  // This prevents stale cache from incorrectly triggering 'complete' state
  const hasConnectedToSession = useRef(false);
  const queryClient = useQueryClient();

  // Start planning mutation
  const startPlanningMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/start-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start planning');
      }
      return res.json() as Promise<StartPlanningResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.planningAgent.started) {
        hasConnectedToSession.current = true;
        setStep('planning');
      } else if (data.planningAgent.error) {
        setError(data.planningAgent.error);
        setStep('error');
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      setStep('error');
    },
  });

  // Poll for planning status (active session) or fetch once (viewing completed)
  const statusQuery = useQuery({
    queryKey: ['planningStatus', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/planning/${issue.identifier}/status`);
      if (!res.ok) throw new Error('Failed to get status');
      return res.json() as Promise<PlanningStatus>;
    },
    enabled: step === 'planning',
    refetchInterval: step === 'planning' ? 2000 : false, // Only poll during active session
  });

  // Stop planning mutation - stops agent AND marks planning as complete (changes to "Planned")
  const stopPlanningMutation = useMutation({
    mutationFn: async () => {
      // First stop the planning agent
      const stopRes = await fetch(`/api/planning/${issue.identifier}`, {
        method: 'DELETE',
      });
      if (!stopRes.ok) throw new Error('Failed to stop planning');

      // Then mark planning as complete (changes label from "Planning" to "Planned")
      const completeRes = await fetch(`/api/issues/${issue.identifier}/complete-planning`, {
        method: 'POST',
      });
      if (!completeRes.ok) {
        console.warn('Failed to mark planning complete, continuing anyway');
      }

      return stopRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      setStep('complete');
    },
  });

  // Abort planning mutation (reverts state to Todo)
  const abortPlanningMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/abort-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: false }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to abort planning');
      }
      return res.json();
    },
    onSuccess: () => {
      onComplete(); // Refresh the issue list
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Start agent mutation - spawns work agent and updates status to "In Progress"
  const startAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start agent');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      onComplete();
      onClose();
    },
    onError: (err: Error) => {
      setError(`Failed to start agent: ${err.message}`);
    },
  });

  // Track previous issue to detect switches
  const prevIssueRef = useRef<string | null>(null);

  // Reset state when dialog closes/opens OR when switching to a different issue
  useEffect(() => {
    const issueChanged = prevIssueRef.current !== null && prevIssueRef.current !== issue.identifier;
    prevIssueRef.current = issue.identifier;

    if (!isOpen) {
      setStep('checking'); // Start with checking on reopen
      setResult(null);
      setError(null);
      setMinimized(false);
      hasConnectedToSession.current = false;
    } else if (issueChanged) {
      // Switching to a different issue - reset state and unminimize
      setStep('checking');
      setResult(null);
      setError(null);
      setMinimized(false);
      hasConnectedToSession.current = false;
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issue.identifier] });
    } else {
      // Dialog is opening - invalidate stale cache to prevent false 'complete' transitions
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issue.identifier] });
      hasConnectedToSession.current = false;
    }
  }, [isOpen, issue.identifier, queryClient]);

  // Check if planning session already exists when dialog opens
  useEffect(() => {
    if (isOpen && step === 'checking') {
      // Check planning status
      fetch(`/api/planning/${issue.identifier}/status`)
        .then(res => res.json())
        .then((data: PlanningStatus) => {
          if (data.active) {
            // Session is running - connect to it directly (skip ready step)
            hasConnectedToSession.current = true;
            setStep('planning');
          } else {
            // No active session - show ready step
            setStep('ready');
          }
        })
        .catch(() => {
          // On error, go to ready
          setStep('ready');
        });
    }
  }, [isOpen, issue.identifier, step]);

  // Watch for session ending while in planning step
  useEffect(() => {
    // Only transition to 'complete' if:
    // 1. We're in the planning step
    // 2. We have fresh status data showing session is inactive
    // 3. We actually connected to a session in THIS dialog instance (not stale cache)
    if (step === 'planning' && statusQuery.data && !statusQuery.data.active && hasConnectedToSession.current) {
      // Session is no longer active - it ended or was stopped
      setStep('complete');
    }
  }, [step, statusQuery.data]);

  const handleStartPlanning = () => {
    setStep('starting');
    startPlanningMutation.mutate();
  };

  const handleStopPlanning = () => {
    stopPlanningMutation.mutate();
  };

  const handleAbortPlanning = () => {
    const confirmed = confirm(
      'Abort planning and return to Todo?\n\n' +
      'This will:\n' +
      '• Stop the planning agent\n' +
      '• Move the issue back to "Todo"\n' +
      '• Keep the workspace (can be deleted separately)\n\n' +
      'Any planning artifacts in the workspace will be preserved.'
    );
    if (confirmed) {
      abortPlanningMutation.mutate();
    }
  };

  const handleComplete = () => {
    // Spawn the work agent - this also updates status to "In Progress"
    startAgentMutation.mutate();
  };

  if (!isOpen) return null;

  // Calculate centered position on first render
  const centeredX = position.x === -1 ? (window.innerWidth - size.width) / 2 : position.x;
  const centeredY = position.y === -1 ? (window.innerHeight - size.height) / 2 : position.y;

  // Get PRD path based on workspace path
  const getPrdPath = () => {
    const workspacePath = result?.workspace?.path || statusQuery.data?.workspacePath;
    if (!workspacePath) return null;
    return `${workspacePath}/docs/${issue.identifier}-plan.md`;
  };

  // When minimized, only render the floating bar (no full-screen wrapper)
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 bg-gray-800 rounded-lg shadow-2xl border border-gray-700 px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-700 transition-colors"
        onClick={() => setMinimized(false)}
      >
        <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-sm text-white font-medium">Plan: {issue.identifier}</span>
        {step === 'planning' && (
          <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop - clicking minimizes instead of closing */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMinimized(true)} />

      {/* Dialog with Rnd for drag/resize */}
      <Rnd
        position={{ x: centeredX, y: centeredY }}
          size={size}
          onDragStop={(_e, d) => setPosition({ x: d.x, y: d.y })}
          onResizeStop={(_e, _direction, ref, _delta, pos) => {
            setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
            setPosition({ x: pos.x, y: pos.y });
          }}
          minWidth={600}
          minHeight={400}
          bounds="window"
          dragHandleClassName="drag-handle"
          enableResizing={{
            top: true,
            right: true,
            bottom: true,
            left: true,
            topRight: true,
            bottomRight: true,
            bottomLeft: true,
            topLeft: true,
          }}
        >
          <div className="w-full h-full bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden flex flex-col">
            {/* Header - drag handle */}
            <div className="drag-handle flex items-center justify-between px-6 py-4 border-b border-gray-700 cursor-move">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Plan: {issue.identifier}</h2>
                  <p className="text-sm text-gray-400 line-clamp-1">{issue.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {step === 'planning' && (
                  <>
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                      <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                      Planning Active
                    </span>
                    <button
                      onClick={handleStopPlanning}
                      disabled={stopPlanningMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      title="Stop the planning agent"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </button>
                  </>
                )}
                <button
                  onClick={() => setMinimized(true)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  title="Hide (planning continues in background)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Checking step - loading state while checking for active session */}
              {step === 'checking' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
                  <p className="text-gray-300">Checking session status...</p>
                </div>
              )}

              {/* Ready step - start planning */}
              {step === 'ready' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center mb-6">
                    <Terminal className="w-10 h-10 text-purple-400" />
                  </div>
                  {/* Check if already in planning state */}
                  {['In Planning', 'Planning', 'Planned', 'Discovery'].includes(issue.status) ? (
                    <>
                      <h3 className="text-xl font-semibold text-white mb-2">Resume Planning Session</h3>
                      <p className="text-gray-400 text-center max-w-md mb-6">
                        This issue is in <span className="text-purple-400 font-medium">"In Planning"</span> state.
                        You can resume planning or abort to return to Todo.
                      </p>

                      <div className="bg-gray-700/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Options:</h4>
                        <ul className="space-y-2 text-sm text-gray-400">
                          <li className="flex items-center gap-2">
                            <Play className="w-4 h-4 text-purple-400" />
                            <span><strong className="text-purple-400">Resume</strong> - Start a new planning agent session</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <X className="w-4 h-4 text-orange-400" />
                            <span><strong className="text-orange-400">Abort</strong> - Return issue to Todo (keeps workspace)</span>
                          </li>
                        </ul>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleAbortPlanning}
                          disabled={abortPlanningMutation.isPending}
                          className="flex items-center gap-2 px-5 py-3 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition-colors font-medium disabled:opacity-50"
                        >
                          <X className="w-5 h-5" />
                          {abortPlanningMutation.isPending ? 'Aborting...' : 'Abort Planning'}
                        </button>
                        <button
                          onClick={handleStartPlanning}
                          className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium"
                        >
                          <Play className="w-5 h-5" />
                          Resume Planning
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold text-white mb-2">Start Planning Session</h3>
                      <p className="text-gray-400 text-center max-w-md mb-6">
                        This will move the issue to <span className="text-purple-400 font-medium">"In Planning"</span>,
                        create a workspace, and start an AI discovery session to help define the implementation plan.
                      </p>

                      <div className="bg-gray-700/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">What happens:</h4>
                        <ul className="space-y-2 text-sm text-gray-400">
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Issue moves to "In Planning" in Linear
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Git worktree created for feature branch
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Opus agent starts discovery conversation
                          </li>
                        </ul>
                      </div>

                      <button
                        onClick={handleStartPlanning}
                        className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium"
                      >
                        <Play className="w-5 h-5" />
                        Start Planning
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Starting step */}
              {step === 'starting' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
                  <p className="text-gray-300">Starting planning session...</p>
                  <p className="text-sm text-gray-500 mt-2">Moving to In Planning, creating workspace, spawning agent</p>
                </div>
              )}

              {/* Planning step - active session with web terminal */}
              {step === 'planning' && (
                <>
                  {/* Web terminal via xterm.js + websocket */}
                  <div className="flex-1 bg-black relative overflow-hidden" style={{ minHeight: '400px' }}>
                    {/* Use result.planningAgent.sessionName as primary source to avoid remounts during status refetch */}
                    {result?.planningAgent.sessionName ? (
                      <XTerminal
                        sessionName={result.planningAgent.sessionName}
                        onDisconnect={() => {
                          // Session ended - only go back to ready if session is actually inactive
                          statusQuery.refetch().then(({ data }) => {
                            if (!data?.active) {
                              setStep('complete');
                            }
                          });
                        }}
                      />
                    ) : statusQuery.data?.sessionName ? (
                      <XTerminal
                        sessionName={statusQuery.data.sessionName}
                        onDisconnect={() => {
                          statusQuery.refetch().then(({ data }) => {
                            if (!data?.active) {
                              setStep('complete');
                            }
                          });
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className="flex items-center gap-2 text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Connecting to terminal...
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer with controls */}
                  <div className="border-t border-gray-700 px-4 py-2 flex items-center justify-between bg-gray-800">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Terminal className="w-4 h-4" />
                      Interactive planning session
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleAbortPlanning}
                        disabled={abortPlanningMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 text-sm rounded transition-colors disabled:opacity-50"
                        title="Stop planning and return to Todo"
                      >
                        <X className="w-4 h-4" />
                        Abort
                      </button>
                      <button
                        onClick={() => {
                          stopPlanningMutation.mutate();
                          statusQuery.refetch();
                        }}
                        disabled={stopPlanningMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-sm rounded transition-colors disabled:opacity-50"
                        title="Done - mark planning complete"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Complete step */}
              {step === 'complete' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-10 h-10 text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Planning Complete</h3>
                  <p className="text-gray-400 text-center max-w-md mb-6">
                    The planning session has ended. Review the plan and start the execution agent.
                  </p>

                  {/* PRD Link */}
                  {getPrdPath() && (
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6 max-w-md w-full">
                      <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-purple-400" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-300 font-medium">Feature Plan</p>
                          <p className="text-xs text-gray-500 font-mono truncate">{getPrdPath()}</p>
                        </div>
                        <a
                          href={`vscode://file${getPrdPath()}`}
                          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors"
                          title="Open in VS Code"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open
                        </a>
                      </div>
                    </div>
                  )}

                  {result && (
                    <div className="bg-gray-700/50 rounded-lg p-4 mb-6 max-w-md w-full">
                      <p className="text-sm text-gray-400 mb-2">Summary:</p>
                      <ul className="space-y-1 text-sm">
                        <li className="text-gray-300">
                          <span className="text-gray-500">Issue:</span> {result.issue.identifier}
                        </li>
                        <li className="text-gray-300">
                          <span className="text-gray-500">State:</span>{' '}
                          <span className="text-purple-400">{result.issue.newState}</span>
                        </li>
                        {result.workspace.created && (
                          <li className="text-gray-300">
                            <span className="text-gray-500">Workspace:</span>{' '}
                            <span className="text-blue-400 font-mono text-xs">{result.workspace.path}</span>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      disabled={startAgentMutation.isPending}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleComplete}
                      disabled={startAgentMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {startAgentMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Play className="w-5 h-5" />
                      )}
                      {startAgentMutation.isPending ? 'Starting Agent...' : 'Start Agent'}
                    </button>
                  </div>
                </div>
              )}

              {/* Error step */}
              {step === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                    <AlertCircle className="w-10 h-10 text-red-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Planning Failed</h3>
                  <p className="text-red-400 text-center max-w-md mb-6">{error}</p>

                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setStep('ready');
                        setError(null);
                      }}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Rnd>
    </div>
  );
}

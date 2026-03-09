import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, AlertCircle, Sparkles, Play, Terminal, Square, FileText, ExternalLink, List } from 'lucide-react';
import { Rnd } from 'react-rnd';
import { Issue } from '../types';
import { XTerminal } from './XTerminal';
import { BeadsDialog } from './BeadsDialog';

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
  isRemote?: boolean;
  vmName?: string;
}

type Step = 'checking' | 'ready' | 'starting' | 'planning' | 'complete' | 'error';

// Default for startDocker - can be overridden by localStorage
const getDefaultStartDocker = (): boolean => {
  const stored = localStorage.getItem('panopticon.planning.startDocker');
  return stored !== null ? stored === 'true' : false; // Default to false — planning agents don't need Docker
};

// Default for workspace location - can be overridden by localStorage
const getDefaultWorkspaceLocation = (): 'local' | 'remote' => {
  const stored = localStorage.getItem('panopticon.planning.workspaceLocation');
  return stored === 'remote' ? 'remote' : 'local'; // Default to local
};

export function PlanDialog({ issue, isOpen, onClose, onComplete }: PlanDialogProps) {
  const [step, setStep] = useState<Step>('checking');
  const [result, setResult] = useState<StartPlanningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 }); // -1 means centered
  const [size, setSize] = useState({ width: 900, height: 720 });
  const [startDocker, setStartDocker] = useState(getDefaultStartDocker);
  const [workspaceLocation, setWorkspaceLocation] = useState<'local' | 'remote'>(getDefaultWorkspaceLocation);
  const [shadowMode, setShadowMode] = useState(false);
  const [watchPlanning, setWatchPlanning] = useState(false);
  const [showBeadsDialog, setShowBeadsDialog] = useState(false);

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
        body: JSON.stringify({ startDocker, workspaceLocation, shadowMode }),
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
        if (watchPlanning) {
          hasConnectedToSession.current = true;
          // Invalidate stale status cache BEFORE entering planning step
          // Without this, the status query returns cached active:false from
          // the initial check, causing premature 'complete' transition (PAN-213)
          queryClient.invalidateQueries({ queryKey: ['planningStatus', issue.identifier] });
          setStep('planning');
        } else {
          // Default: close dialog immediately, planning continues in background
          onClose();
        }
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
      const stopData = await stopRes.json();

      // Then mark planning as complete (changes label from "Planning" to "Planned")
      const completeRes = await fetch(`/api/issues/${issue.identifier}/complete-planning`, {
        method: 'POST',
      });
      if (!completeRes.ok) {
        console.warn('Failed to mark planning complete, continuing anyway');
      }

      return stopData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      setStep('complete');
    },
    onError: (err: Error) => {
      console.error('Stop planning failed:', err);
      setError(err.message);
      setStep('error');
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
        body: JSON.stringify({ issueId: issue.identifier, phase: 'implementation' }),
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
        .then((data: PlanningStatus & { planningCompleted?: boolean }) => {
          if (data.active) {
            // Session is running - connect to it directly (skip ready step)
            hasConnectedToSession.current = true;
            setStep('planning');
          } else if (data.planningCompleted) {
            // Planning was done but not marked complete - go directly to complete step
            // This allows user to click "Done Planning" without restarting
            setStep('complete');
          } else {
            // No active session and no completed planning - show ready step
            setStep('ready');
          }
        })
        .catch(() => {
          // On error, go to ready
          setStep('ready');
        });
    }
  }, [isOpen, issue.identifier, step]);

  // DELIBERATE: No automatic transition to 'complete' based on session status.
  // Previous attempts to auto-detect session ending via polling caused persistent
  // premature 'complete' transitions due to stale cache, Docker network disruption
  // (PAN-207), and PTY disconnect race conditions. The ONLY paths to 'complete' are:
  // 1. User clicks "Done" button → stopPlanningMutation.onSuccess
  // 2. Initial check finds .planning-complete marker → step set in checking effect

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
        className="fixed bottom-4 right-4 z-50 bg-surface-raised rounded-lg shadow-2xl border border-divider px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-surface-overlay transition-colors"
        onClick={async () => {
          // Recheck session status when unminimizing — recover to planning
          // if session is still active but step was prematurely set to 'complete'
          if (step === 'complete') {
            try {
              const res = await fetch(`/api/planning/${issue.identifier}/status`);
              const data = await res.json();
              if (data.active) {
                hasConnectedToSession.current = true;
                setStep('planning');
              }
            } catch {}
          }
          setMinimized(false);
        }}
      >
        <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-content" />
        </div>
        <span className="text-sm text-content font-medium">Plan: {issue.identifier}</span>
        {step === 'planning' && (
          <>
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            {statusQuery.data?.isRemote ? (
              <span className="px-1.5 py-0.5 bg-blue-500/30 text-blue-300 text-xs rounded">Remote</span>
            ) : (
              <span className="px-1.5 py-0.5 bg-gray-500/30 text-content-subtle text-xs rounded">Local</span>
            )}
          </>
        )}
        {step === 'complete' && (
          <span className="px-1.5 py-0.5 bg-green-500/30 text-green-300 text-xs rounded">Done</span>
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
          <div className="w-full h-full bg-surface-raised rounded-xl shadow-2xl border border-divider overflow-hidden flex flex-col">
            {/* Header - drag handle */}
            <div className="drag-handle flex items-center justify-between px-6 py-4 border-b border-divider cursor-move">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-content" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-content">Plan: {issue.identifier}</h2>
                  <p className="text-sm text-content-subtle line-clamp-1">{issue.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {step === 'planning' && (
                  <>
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                      <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                      Planning Active
                    </span>
                    {statusQuery.data?.isRemote ? (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full" title={statusQuery.data.vmName ? `VM: ${statusQuery.data.vmName}` : undefined}>
                        Remote
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-500/20 text-content-subtle text-xs rounded-full">
                        Local
                      </span>
                    )}
                    <button
                      onClick={handleStopPlanning}
                      disabled={stopPlanningMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-content text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      title="Stop the planning agent"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </button>
                  </>
                )}
                <button
                  onClick={() => setMinimized(true)}
                  className="p-2 text-content-subtle hover:text-content hover:bg-surface-overlay rounded-lg transition-colors"
                  title="Hide (planning continues in background)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto flex flex-col">
              {/* Checking step - loading state while checking for active session */}
              {step === 'checking' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
                  <p className="text-content-body">Checking session status...</p>
                </div>
              )}

              {/* Ready step - start planning */}
              {step === 'ready' && (
                <div className="flex-1 flex flex-col items-center p-8 pt-6 overflow-y-auto">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center mb-6">
                    <Terminal className="w-10 h-10 text-purple-400" />
                  </div>
                  {/* Check if already in planning state */}
                  {['In Planning', 'Planning', 'Planned', 'Discovery'].includes(issue.status) ? (
                    <>
                      <h3 className="text-xl font-semibold text-content mb-2">Resume Planning Session</h3>
                      <p className="text-content-subtle text-center max-w-md mb-6">
                        This issue is in <span className="text-purple-400 font-medium">"In Planning"</span> state.
                        You can resume planning or abort to return to Todo.
                      </p>

                      <div className="bg-surface-overlay/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-content-body mb-2">Options:</h4>
                        <ul className="space-y-2 text-sm text-content-subtle">
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

                      {/* Watch planning option */}
                      <label className="flex items-center gap-3 mb-4 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={watchPlanning}
                          onChange={(e) => setWatchPlanning(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-500 bg-surface-overlay text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-800"
                        />
                        <span className="text-sm text-content-body">
                          Stay and watch planning
                          <span className="text-content-muted ml-1">(keep dialog open; you&apos;ll see INPUT when agent needs you)</span>
                        </span>
                      </label>

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
                          className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-content rounded-lg transition-colors font-medium"
                        >
                          <Play className="w-5 h-5" />
                          Resume Planning
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold text-content mb-2">Start Planning Session</h3>
                      <p className="text-content-subtle text-center max-w-md mb-6">
                        This will move the issue to <span className="text-purple-400 font-medium">"In Planning"</span>,
                        create a workspace, and start an AI discovery session to help define the implementation plan.
                      </p>

                      <div className="bg-surface-overlay/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-content-body mb-2">What happens:</h4>
                        <ul className="space-y-2 text-sm text-content-subtle">
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Issue moves to "In Planning" in {issue.source === 'github' ? 'GitHub' : 'Linear'}
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Git worktree created for feature branch
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Planning agent starts discovery conversation
                          </li>
                        </ul>
                      </div>

                      {/* Workspace location option */}
                      <div className="mb-4 w-full max-w-md">
                        <label className="text-sm font-medium text-content-body mb-2 block">Workspace Location</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="workspaceLocation"
                              value="local"
                              checked={workspaceLocation === 'local'}
                              onChange={() => {
                                setWorkspaceLocation('local');
                                localStorage.setItem('panopticon.planning.workspaceLocation', 'local');
                              }}
                              className="w-4 h-4 border-gray-500 bg-surface-overlay text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-800"
                            />
                            <span className="text-sm text-content-body">Local</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="workspaceLocation"
                              value="remote"
                              checked={workspaceLocation === 'remote'}
                              onChange={() => {
                                setWorkspaceLocation('remote');
                                localStorage.setItem('panopticon.planning.workspaceLocation', 'remote');
                              }}
                              className="w-4 h-4 border-gray-500 bg-surface-overlay text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-800"
                            />
                            <span className="text-sm text-content-body">Remote (exe.dev)</span>
                          </label>
                        </div>
                      </div>

                      {/* Shadow Engineering option */}
                      <label className="flex items-center gap-3 mb-4 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shadowMode}
                          onChange={(e) => setShadowMode(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-500 bg-surface-overlay text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                        />
                        <span className="text-sm text-content-body">
                          Shadow Engineering
                          <span className="text-content-muted ml-1">(AI observes your workflow, doesn&apos;t modify code)</span>
                        </span>
                      </label>

                      {/* Docker option */}
                      <label className="flex items-center gap-3 mb-4 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={startDocker}
                          onChange={(e) => {
                            setStartDocker(e.target.checked);
                            localStorage.setItem('panopticon.planning.startDocker', String(e.target.checked));
                          }}
                          className="w-4 h-4 rounded border-gray-500 bg-surface-overlay text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-800"
                        />
                        <span className="text-sm text-content-body">
                          Start Docker containers
                          <span className="text-content-muted ml-1">(dev environment ready for testing)</span>
                        </span>
                      </label>

                      {/* Watch planning option */}
                      <label className="flex items-center gap-3 mb-6 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={watchPlanning}
                          onChange={(e) => setWatchPlanning(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-500 bg-surface-overlay text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-800"
                        />
                        <span className="text-sm text-content-body">
                          Stay and watch planning
                          <span className="text-content-muted ml-1">(keep dialog open; you&apos;ll see INPUT when agent needs you)</span>
                        </span>
                      </label>

                      <button
                        onClick={handleStartPlanning}
                        className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-content rounded-lg transition-colors font-medium"
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
                  <p className="text-content-body">Starting planning session...</p>
                  <p className="text-sm text-content-muted mt-2">Moving to In Planning, creating workspace, spawning agent</p>
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
                          // PTY/WebSocket disconnected — this often happens during Docker
                          // network disruption (PAN-207), NOT because planning actually ended.
                          // Don't eagerly transition to 'complete' here. Instead, just trigger
                          // a status refetch and let the polling useEffect handle the transition
                          // with proper guards (dataUpdatedAt, 10s minimum, etc.)
                          statusQuery.refetch();
                        }}
                      />
                    ) : statusQuery.data?.sessionName ? (
                      <XTerminal
                        sessionName={statusQuery.data.sessionName}
                        onDisconnect={() => {
                          // Same as above — don't eagerly transition, just refetch
                          statusQuery.refetch();
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className="flex items-center gap-2 text-content-muted">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Connecting to terminal...
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer with controls */}
                  <div className="border-t border-divider px-4 py-2 flex items-center justify-between bg-surface-raised">
                    <div className="flex items-center gap-2 text-sm text-content-subtle">
                      <Terminal className="w-4 h-4" />
                      Interactive planning session
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowBeadsDialog(true)}
                        className="flex items-center gap-1 px-3 py-1 bg-surface-overlay hover:bg-surface-emphasis text-content-body text-sm rounded transition-colors"
                        title="View tasks created during planning"
                      >
                        <List className="w-4 h-4" />
                        Tasks
                      </button>
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
                  <h3 className="text-xl font-semibold text-content mb-2">Planning Complete</h3>
                  <p className="text-content-subtle text-center max-w-md mb-6">
                    The planning session has ended. Review the plan and start the execution agent.
                  </p>

                  {/* PRD Link */}
                  {getPrdPath() && (
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6 max-w-md w-full">
                      <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-purple-400" />
                        <div className="flex-1">
                          <p className="text-sm text-content-body font-medium">Feature Plan</p>
                          <p className="text-xs text-content-muted font-mono truncate">{getPrdPath()}</p>
                        </div>
                        <a
                          href={`vscode://file${getPrdPath()}`}
                          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-content text-sm rounded-lg transition-colors"
                          title="Open in VS Code"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Tasks Link */}
                  <button
                    onClick={() => setShowBeadsDialog(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors mb-6"
                  >
                    <List className="w-5 h-5" />
                    View Tasks
                    <span className="text-xs text-green-600">(beads created during planning)</span>
                  </button>

                  {result && (
                    <div className="bg-surface-overlay/50 rounded-lg p-4 mb-6 max-w-md w-full">
                      <p className="text-sm text-content-subtle mb-2">Summary:</p>
                      <ul className="space-y-1 text-sm">
                        <li className="text-content-body">
                          <span className="text-content-muted">Issue:</span> {result.issue.identifier}
                        </li>
                        <li className="text-content-body">
                          <span className="text-content-muted">State:</span>{' '}
                          <span className="text-purple-400">{result.issue.newState}</span>
                        </li>
                        {result.workspace.created && (
                          <li className="text-content-body">
                            <span className="text-content-muted">Workspace:</span>{' '}
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
                      className="px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors disabled:opacity-50"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleComplete}
                      disabled={startAgentMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-content rounded-lg transition-colors disabled:opacity-50"
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
                  <h3 className="text-xl font-semibold text-content mb-2">Planning Failed</h3>
                  <p className="text-red-400 text-center max-w-md mb-6">{error}</p>

                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setStep('ready');
                        setError(null);
                      }}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-content rounded-lg transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Rnd>

      {/* Beads Tasks Dialog */}
      <BeadsDialog
        issueId={issue.identifier}
        isOpen={showBeadsDialog}
        onClose={() => setShowBeadsDialog(false)}
      />
    </div>
  );
}

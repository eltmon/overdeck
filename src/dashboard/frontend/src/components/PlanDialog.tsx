import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, AlertCircle, Sparkles, Play, Terminal, Square, List, RefreshCw } from 'lucide-react';
import { Rnd } from 'react-rnd';
import { useDashboardStore } from '../lib/store';
import { Issue } from '../types';
import { XTerminal } from './XTerminal';
import { BeadsTasksPanel } from './BeadsTasksPanel';
import { useConfirm } from './DialogProvider';
import { PlanSetupScreen, type SetupProgressEvent } from './PlanSetupScreen';
import { canUsePickerHarness, getProviderForPickerModel, type Harness, type ModelGroup } from './shared/ModelPicker';

interface PlanDialogProps {
  issue: Issue;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onTerminalReleased?: () => void;
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
  hasPromptFile?: boolean;
  hasStateFile?: boolean;
  hasCompletionMarker?: boolean;
}

type Step = 'checking' | 'ready' | 'starting' | 'setting-up' | 'planning' | 'error';

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

export function PlanDialog({ issue, isOpen, onClose, onComplete, onTerminalReleased }: PlanDialogProps) {
  const [step, setStep] = useState<Step>('checking');
  const [result, setResult] = useState<StartPlanningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 }); // -1 means centered
  const [size, setSize] = useState({ width: 900, height: 720 });
  const [startDocker, setStartDocker] = useState(getDefaultStartDocker);
  const [workspaceLocation, setWorkspaceLocation] = useState<'local' | 'remote'>(getDefaultWorkspaceLocation);
  const [shadowMode, setShadowMode] = useState(false);
  const [modelOverride, setModelOverride] = useState<string>(''); // '' = use settings default
  const [harnessOverride, setHarnessOverride] = useState<Harness>('claude-code');
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [watchPlanning, setWatchPlanning] = useState(true);
  // Ref so async SSE callbacks always read the live checkbox value, not a stale closure copy
  const watchPlanningRef = useRef(true);
  const [showTasksPanel, setShowTasksPanel] = useState(false);
  const [setupSteps, setSetupSteps] = useState<SetupProgressEvent[]>([]);
  const [setupSessionName, setSetupSessionName] = useState<string | null>(null);

  // Track if we've actually connected to a planning session in THIS dialog instance.
  const hasConnectedToSession = useRef(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  // Fetch settings to know the default planning-agent model
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      return res.json() as Promise<{ models: { overrides: Record<string, string> } }>;
    },
    staleTime: 60000,
  });
  const defaultPlanningModel = settingsQuery.data?.models?.overrides?.['planning-agent'] || 'claude-opus-4-6';

  // Fetch available models from all configured providers
  const availableModelsQuery = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await fetch('/api/settings/available-models');
      if (!res.ok) throw new Error('Failed to load available models');
      return res.json() as Promise<Record<string, Array<{ id: string; name: string; costPer1MTokens: number }>>>;
    },
    staleTime: 60000,
  });

  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    minimax: 'MiniMax',
    zai: 'Z.AI',
    kimi: 'Kimi',
    openrouter: 'OpenRouter',
  };


  const planningModelGroups: ModelGroup[] = availableModelsQuery.data
    ? Object.entries(availableModelsQuery.data)
      .filter(([, models]) => models.length > 0)
      .map(([provider, models]) => ({
        provider,
        label: PROVIDER_LABELS[provider] || provider,
        models: models.map((model) => ({
          id: model.id,
          label: model.name,
          provider,
          costPer1MTokens: model.costPer1MTokens,
        })),
      }))
    : [];
  const effectivePlanningModel = modelOverride || defaultPlanningModel;
  const planningHarnessDecision = canUsePickerHarness(
    harnessOverride,
    getProviderForPickerModel(effectivePlanningModel, planningModelGroups),
    'subscription',
  );

  // Start planning via SSE stream — replaces the old fire-and-forget mutation.
  // Uses fetch with streaming body parsing since EventSource only supports GET.
  const startPlanningViaSSE = useCallback(async () => {
    setStep('setting-up');
    setSetupSteps([]);
    setSetupSessionName(null);
    setError(null);

    try {
      const res = await fetch(`/api/issues/${issue.identifier}/start-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDocker, workspaceLocation, shadowMode, model: modelOverride || undefined, harness: harnessOverride, effort }),
      });

      if (!res.ok) {
        // Non-SSE error response (e.g. 409 conflict, 500 server error, 502 Bad Gateway)
        let errorMsg = 'Failed to start planning';
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          const text = await res.text().catch(() => '');
          errorMsg = text || `Server error (${res.status})`;
        }
        setError(errorMsg);
        setStep('error');
        return;
      }

      // Parse SSE stream from response body
      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response stream');
        setStep('error');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'started') {
              // Initial metadata — build a result object for compatibility
              setResult({
                success: true,
                issue: event.issue,
                workspace: { created: true, path: event.workspace.path },
                planningAgent: { started: true, sessionName: event.sessionName },
              });
            } else if (event.type === 'progress') {
              setSetupSteps(prev => {
                const updated = [...prev];
                const progressEvent: SetupProgressEvent = {
                  step: event.step,
                  total: event.total,
                  label: event.label,
                  detail: event.detail,
                  status: event.status,
                };
                // Match by step number AND label (workspace sub-steps share step 1 but have different labels)
                const existing = updated.findIndex(s => s.step === event.step && s.label === event.label);
                if (existing >= 0) {
                  updated[existing] = progressEvent;
                } else {
                  updated.push(progressEvent);
                }
                return updated;
              });

              // If a step errored, show error state
              if (event.status === 'error') {
                setError(event.detail);
                setStep('error');
              }
            } else if (event.type === 'complete') {
              setSetupSessionName(event.sessionName);
              if (watchPlanningRef.current) {
                hasConnectedToSession.current = true;
                queryClient.invalidateQueries({ queryKey: ['planningStatus', issue.identifier] });
                // Brief delay to let the user see the completed state
                setTimeout(() => setStep('planning'), 600);
              } else {
                // Close dialog — planning continues in background
                onClose();
              }
            } else if (event.type === 'error') {
              setError(event.error || 'Planning setup failed');
              setStep('error');
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setStep('error');
    }
  }, [issue.identifier, startDocker, workspaceLocation, shadowMode, modelOverride, harnessOverride, effort, watchPlanning, queryClient, onClose]);

  // Legacy mutation wrapper — keeps the same handleStartPlanning interface
  const startPlanningMutation = {
    isPending: step === 'setting-up',
    mutate: startPlanningViaSSE,
  };

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

  // Planning state — drives the "tasks need generation" callout in the footer.
  // Polled while the planning step is open so the callout vanishes the moment
  // beads exist (whether the agent ran pan plan finalize or the user clicked
  // Generate Tasks here).
  const planningStateQuery = useQuery({
    queryKey: ['planning-state', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/planning-state`);
      if (!res.ok) throw new Error('Failed to fetch planning state');
      return res.json() as Promise<{ hasPlan: boolean; hasBeads: boolean; beadsCount: number }>;
    },
    enabled: step === 'planning',
    refetchInterval: step === 'planning' ? 4000 : false,
  });
  const planningHasPlan = planningStateQuery.data?.hasPlan ?? false;
  const planningHasBeads = planningStateQuery.data?.hasBeads ?? false;
  const tasksNeedGeneration = planningHasPlan && !planningHasBeads;

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/generate-tasks`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || (body?.errors?.[0] ?? 'Failed to generate tasks'));
      }
      return body as { success: true; created: string[]; count: number };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['planning-state', issue.identifier] });
      await statusQuery.refetch();
      toast.success(`Generated ${data.count} bead${data.count === 1 ? '' : 's'} from the vBRIEF plan.`);
    },
    onError: (err: Error) => {
      toast.error(`Generate tasks failed: ${err.message}`);
    },
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

      // Then mark planning as complete (changes label from "Planning" to "Planned").
      // skipKill: true because the DELETE above already killed the tmux session —
      // avoid a redundant kill that would always log "no such session" noise.
      const completeRes = await fetch(`/api/issues/${issue.identifier}/complete-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipKill: true }),
      });
      if (!completeRes.ok) {
        console.warn('Failed to mark planning complete, continuing anyway');
      }
      const completeData = await completeRes.json().catch(() => ({}));

      return { ...stopData, beadsWarning: completeData.beadsWarning ?? null };
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      if (data?.beadsWarning) {
        toast.warning(data.beadsWarning, { duration: 10000 });
      }
      onTerminalReleased?.();
      onComplete();
      onClose();
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
      setSetupSteps([]);
      setSetupSessionName(null);
      setWatchPlanning(true);
      watchPlanningRef.current = true;
      hasConnectedToSession.current = false;
    } else if (issueChanged) {
      // Switching to a different issue - reset state and unminimize
      setStep('checking');
      setResult(null);
      setError(null);
      setMinimized(false);
      setSetupSteps([]);
      setSetupSessionName(null);
      setWatchPlanning(true);
      watchPlanningRef.current = true;
      hasConnectedToSession.current = false;
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issue.identifier] });
    } else {
      // Dialog is opening - invalidate stale cache before checking session status
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
            if (!watchPlanningRef.current) { onClose(); return; }
            // Seed setupSessionName so XTerminal mounts immediately without waiting for statusQuery
            if (data.sessionName) setSetupSessionName(data.sessionName);
            hasConnectedToSession.current = true;
            setStep('planning');
          } else {
            // No active session - show the planning dialog so the user can resume or start.
            setStep('ready');
          }
        })
        .catch(() => {
          // On error, go to ready
          setStep('ready');
        });
    }
  }, [isOpen, issue.identifier, step]);

  // DELIBERATE: No automatic completion screen based on session status.
  // Previous attempts to auto-detect session ending via polling caused persistent
  // premature transitions due to stale cache, Docker network disruption
  // (PAN-207), and PTY disconnect race conditions.

  const handleStartPlanning = () => {
    startPlanningViaSSE();
  };

  const handleStopPlanning = () => {
    // Transition away from 'planning' step IMMEDIATELY to unmount XTerminal
    // before the API call kills the tmux session. Otherwise the user sees
    // "Connection lost. Reconnecting..." while the mutation runs.
    setStep('starting');  // Reuse starting step as a "completing..." state
    stopPlanningMutation.mutate();
  };

  const handleAbortPlanning = async () => {
    const confirmed = await confirm({
      title: 'Stop Planning',
      message: 'Stop planning and return to Todo?\n\nThis will:\n• Stop the planning agent\n• Move the issue back to "Todo"\n• Keep the workspace (can be deleted separately)\n\nAny planning artifacts in the workspace will be preserved.',
      confirmLabel: 'Stop Planning',
      variant: 'destructive',
    });
    if (confirmed) {
      abortPlanningMutation.mutate();
    }
  };

  // Watch for planning failures via domain events (applied to store by EventRouter).
  // When the store sequence advances, check planning status via REST.
  const storeSequence = useDashboardStore((s) => s.sequence);
  useEffect(() => {
    if (!isOpen || (step !== 'starting' && step !== 'planning')) return;
    // Re-check planning status when new events arrive
    fetch(`/api/planning/${issue.identifier}/status`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.status === 'failed' || data?.error) {
          setError(data.error || 'Planning failed');
          setStep('error');
        }
      })
      .catch(() => {});
  }, [isOpen, step, issue.identifier, storeSequence]);

  if (!isOpen) return null;

  // Calculate centered position on first render
  const centeredX = position.x === -1 ? (window.innerWidth - size.width) / 2 : position.x;
  const centeredY = position.y === -1 ? (window.innerHeight - size.height) / 2 : position.y;

  // When minimized, only render the floating bar (no full-screen wrapper)
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 bg-card rounded-lg shadow-2xl border border-border px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-popover transition-colors"
        onClick={() => setMinimized(false)}
      >
        <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-foreground" />
        </div>
        <span className="text-sm text-foreground font-medium">Plan: {issue.identifier}</span>
        {step === 'setting-up' && (
          <>
            <Loader2 className="w-3 h-3 text-signal-review animate-spin" />
            <span className="px-1.5 py-0.5 badge-bg-signal-review text-signal-review-foreground text-xs rounded">Setting up</span>
          </>
        )}
        {step === 'planning' && (
          <>
            <span className="w-2 h-2 bg-signal-review rounded-full animate-pulse" />
            {statusQuery.data?.isRemote ? (
              <span className="px-1.5 py-0.5 badge-bg-primary text-primary text-xs rounded">Remote</span>
            ) : (
              <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">Local</span>
            )}
          </>
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
          <div className="w-full h-full bg-card rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col">
            {/* Header - drag handle */}
            <div className="drag-handle flex items-center justify-between px-6 py-4 border-b border-border cursor-move">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Plan: {issue.identifier}</h2>
                  <p className="text-sm text-muted-foreground line-clamp-1">{issue.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {step === 'planning' && (
                  <>
                    <span className="flex items-center gap-1.5 px-2 py-1 badge-bg-signal-review text-signal-review text-xs rounded-full">
                      <span className="w-2 h-2 bg-signal-review rounded-full animate-pulse" />
                      Planning Active
                    </span>
                    {statusQuery.data?.isRemote ? (
                      <span className="px-2 py-1 badge-bg-primary text-primary text-xs rounded-full" title={statusQuery.data.vmName ? `VM: ${statusQuery.data.vmName}` : undefined}>
                        Remote
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">
                        Local
                      </span>
                    )}
                    <button
                      onClick={handleStopPlanning}
                      disabled={stopPlanningMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      title="Stop the planning agent"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-popover rounded-lg transition-colors"
                  title="Close (planning continues in background)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className={`flex-1 flex flex-col ${step === 'planning' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {/* Checking step - loading state while checking for active session */}
              {step === 'checking' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <Loader2 className="w-12 h-12 text-signal-review animate-spin mb-4" />
                  <p className="text-foreground">
                    {['In Planning', 'Planning', 'Discovery'].includes(issue.status)
                      ? 'Reconnecting to active planning session...'
                      : 'Checking session status...'}
                  </p>
                  <p className="text-muted-foreground text-sm mt-2">
                    {['In Planning', 'Planning', 'Discovery'].includes(issue.status)
                      ? 'Loading terminal for your planning agent'
                      : 'Looking for an existing session'}
                  </p>
                </div>
              )}

              {/* Ready step - start planning */}
              {step === 'ready' && (
                <div className="flex-1 flex flex-col items-center p-8 pt-6 overflow-y-auto">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-signal-review/20 to-primary/20 border border-signal-review/30 flex items-center justify-center mb-6">
                    <Terminal className="w-10 h-10 text-signal-review" />
                  </div>
                  {/* Check if already in planning state */}
                  {(['In Planning', 'Planning', 'Planned', 'Discovery'].includes(issue.status) || issue.labels?.some(l => l.toLowerCase() === 'planning')) ? (
                    <>
                      <h3 className="text-xl font-semibold text-foreground mb-2">Resume Planning Session</h3>
                      <p className="text-muted-foreground text-center max-w-md mb-6">
                        This issue is in <span className="text-signal-review font-medium">"In Planning"</span> state.
                        You can resume planning or abort to return to Todo.
                      </p>

                      <div className="bg-popover/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-foreground mb-2">Options:</h4>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-center gap-2">
                            <Play className="w-4 h-4 text-signal-review" />
                            <span><strong className="text-signal-review">Resume</strong> - Start a new planning agent session</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <X className="w-4 h-4 text-warning-foreground" />
                            <span><strong className="text-warning-foreground">Abort</strong> - Return issue to Todo (keeps workspace)</span>
                          </li>
                        </ul>
                      </div>

                      <div className="w-full max-w-md mb-6">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={watchPlanning}
                            onChange={(e) => { setWatchPlanning(e.target.checked); watchPlanningRef.current = e.target.checked; }}
                            className="w-4 h-4 rounded border-border bg-popover text-signal-review focus:ring-signal-review focus:ring-offset-background"
                          />
                          <span className="text-sm text-foreground">
                            Stay and watch planning
                            <span className="text-muted-foreground ml-1">(keep dialog open; you&apos;ll see INPUT when agent needs you)</span>
                          </span>
                        </label>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleAbortPlanning}
                          disabled={abortPlanningMutation.isPending}
                          className="flex items-center gap-2 px-5 py-3 badge-bg-warning hover:bg-warning/20 text-warning-foreground rounded-lg transition-colors font-medium disabled:opacity-50"
                        >
                          <X className="w-5 h-5" />
                          {abortPlanningMutation.isPending ? 'Aborting...' : 'Abort Planning'}
                        </button>
                        <button
                          onClick={handleStartPlanning}
                          className="flex items-center gap-2 px-6 py-3 bg-signal-review hover:bg-signal-review/90 text-signal-review-foreground rounded-lg transition-colors font-medium"
                        >
                          <Play className="w-5 h-5" />
                          Resume Planning
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold text-foreground mb-2">Start Planning Session</h3>
                      <p className="text-muted-foreground text-center max-w-md mb-6">
                        This will move the issue to <span className="text-signal-review font-medium">"In Planning"</span>,
                        create a workspace, and start an AI discovery session to help define the implementation plan.
                      </p>

                      <div className="bg-popover/50 rounded-lg p-4 mb-6 max-w-md w-full">
                        <h4 className="text-sm font-medium text-foreground mb-2">What happens:</h4>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            Issue moves to "In Planning" in {issue.source === 'github' ? 'GitHub' : 'Linear'}
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            Git worktree created for feature branch
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            Planning agent starts discovery conversation
                          </li>
                        </ul>
                      </div>

                      {/* Options section */}
                      <div className="w-full max-w-md space-y-4 mb-6">
                        {/* Workspace location */}
                        <div>
                          <label className="text-sm font-medium text-foreground mb-2 block">Workspace Location</label>
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
                                className="w-4 h-4 border-border bg-popover text-signal-review focus:ring-signal-review focus:ring-offset-background"
                              />
                              <span className="text-sm text-foreground">Local</span>
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
                                className="w-4 h-4 border-border bg-popover text-signal-review focus:ring-signal-review focus:ring-offset-background"
                              />
                              <span className="text-sm text-foreground">Remote (Fly.io)</span>
                            </label>
                          </div>
                        </div>

                        {/* Checkboxes */}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={watchPlanning}
                            onChange={(e) => { setWatchPlanning(e.target.checked); watchPlanningRef.current = e.target.checked; }}
                            className="w-4 h-4 rounded border-border bg-popover text-signal-review focus:ring-signal-review focus:ring-offset-background"
                          />
                          <span className="text-sm text-foreground">
                            Stay and watch planning
                            <span className="text-muted-foreground ml-1">(keep dialog open; you&apos;ll see INPUT when agent needs you)</span>
                          </span>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={shadowMode}
                            onChange={(e) => setShadowMode(e.target.checked)}
                            className="w-4 h-4 rounded border-border bg-popover text-primary focus:ring-primary focus:ring-offset-background"
                          />
                          <span className="text-sm text-foreground">
                            Shadow Engineering
                            <span className="text-muted-foreground ml-1">(AI observes your workflow, doesn&apos;t modify code)</span>
                          </span>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={startDocker}
                            onChange={(e) => {
                              setStartDocker(e.target.checked);
                              localStorage.setItem('panopticon.planning.startDocker', String(e.target.checked));
                            }}
                            className="w-4 h-4 rounded border-border bg-popover text-signal-review focus:ring-signal-review focus:ring-offset-background"
                          />
                          <span className="text-sm text-foreground">
                            Start Docker containers
                            <span className="text-muted-foreground ml-1">(dev environment ready for testing)</span>
                          </span>
                        </label>

                        {/* Model override */}
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">Model</label>
                          <select
                            value={modelOverride}
                            onChange={(e) => setModelOverride(e.target.value)}
                            className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-signal-review"
                          >
                            <option value="">Settings default ({defaultPlanningModel})</option>
                            {availableModelsQuery.data && Object.entries(availableModelsQuery.data)
                              .filter(([, models]) => models.length > 0)
                              .map(([provider, models]) => (
                                <optgroup key={provider} label={PROVIDER_LABELS[provider] || provider}>
                                  {models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                          </select>
                        </div>

                        {/* Harness override */}
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">Harness</label>
                          <select
                            value={planningHarnessDecision.allowed ? harnessOverride : 'claude-code'}
                            onChange={(e) => setHarnessOverride(e.target.value as Harness)}
                            className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-signal-review"
                          >
                            <option value="claude-code">Claude Code (default)</option>
                            <option value="pi" disabled={!canUsePickerHarness('pi', getProviderForPickerModel(effectivePlanningModel, planningModelGroups), 'subscription').allowed}>
                              Pi RPC{!canUsePickerHarness('pi', getProviderForPickerModel(effectivePlanningModel, planningModelGroups), 'subscription').allowed ? ' — unavailable for Anthropic subscription' : ''}
                            </option>
                          </select>
                          {!planningHarnessDecision.allowed && (
                            <p className="text-xs text-warning mt-1">{planningHarnessDecision.reason}</p>
                          )}
                        </div>

                        {/* Effort level */}
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">Effort</label>
                          <div className="flex gap-2">
                            {(['low', 'medium', 'high'] as const).map((level) => (
                              <button
                                key={level}
                                type="button"
                                onClick={() => setEffort(level)}
                                className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
                                  effort === level
                                    ? 'bg-signal-review/20 border-signal-review text-signal-review font-medium'
                                    : 'bg-popover border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                                }`}
                              >
                                {level}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {effort === 'low' && 'Quick planning — concise tasks, minimal exploration'}
                            {effort === 'medium' && 'Balanced — standard planning depth (default)'}
                            {effort === 'high' && 'Deep analysis — thorough exploration, edge cases, tradeoffs'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleStartPlanning}
                        className="flex items-center gap-2 px-6 py-3 bg-signal-review hover:bg-signal-review/90 text-signal-review-foreground rounded-lg transition-colors font-medium"
                      >
                        <Play className="w-5 h-5" />
                        Start Planning
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Starting step — brief transition before SSE connects */}
              {step === 'starting' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <Loader2 className="w-12 h-12 text-signal-review animate-spin mb-4" />
                  <p className="text-foreground">Starting planning session...</p>
                  <p className="text-sm text-muted-foreground mt-2">Moving to In Planning, creating workspace, spawning agent</p>
                </div>
              )}

              {/* Setting up step — SSE progress stream */}
              {step === 'setting-up' && (
                <PlanSetupScreen
                  issueIdentifier={issue.identifier}
                  issueTitle={issue.title}
                  steps={setupSteps}
                  error={error}
                />
              )}

              {/* Planning step - active session with web terminal */}
              {step === 'planning' && (
                <>
                  {/* Toggle between terminal and tasks panel */}
                  <div className="flex-1 bg-black relative overflow-hidden" style={{ minHeight: '400px' }}>
                    {showTasksPanel ? (
                      <div className="h-full overflow-auto bg-card">
                        <BeadsTasksPanel issueId={issue.identifier} />
                      </div>
                    ) : (
                      <>
                        {/* Use result.planningAgent.sessionName as primary source, then setupSessionName from SSE, then status query */}
                        {(result?.planningAgent.sessionName || setupSessionName) ? (
                          <XTerminal
                            sessionName={(result?.planningAgent.sessionName || setupSessionName)!}
                            onDisconnect={() => {
                              statusQuery.refetch();
                            }}
                          />
                        ) : statusQuery.data?.sessionName ? (
                          <XTerminal
                            sessionName={statusQuery.data.sessionName}
                            onDisconnect={() => {
                              statusQuery.refetch();
                            }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-signal-review" />
                            <p className="text-sm text-foreground">Attaching to planning session...</p>
                            <p className="text-xs text-muted-foreground font-mono">planning-{issue.identifier.toLowerCase()}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Tasks-needed callout — shown when a vBRIEF plan exists but no beads were created.
                      Planning isn't truly "done" until tasks exist; this surfaces the action
                      directly in the planning dialog instead of forcing the user to find the
                      Generate Tasks chip on the kanban card. */}
                  {tasksNeedGeneration && (
                    <div className="border-t border-warning/40 bg-warning/10 px-4 py-3 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-warning-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-warning-foreground">Tasks not yet generated</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          A vBRIEF plan exists but no beads have been created. Generate tasks to finish planning so the Done button unlocks.
                        </p>
                      </div>
                      <button
                        onClick={() => generateTasksMutation.mutate()}
                        disabled={generateTasksMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-warning hover:bg-warning/90 text-warning-foreground text-sm font-medium rounded transition-colors disabled:opacity-50 shrink-0"
                      >
                        {generateTasksMutation.isPending
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Sparkles className="w-4 h-4" />}
                        Generate Tasks
                      </button>
                    </div>
                  )}

                  {/* Footer with controls */}
                  <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-card">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Terminal className="w-4 h-4" />
                      Interactive planning session
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowTasksPanel(!showTasksPanel)}
                        className={`flex items-center gap-1 px-3 py-1 text-sm rounded transition-colors ${
                          showTasksPanel
                            ? 'badge-bg-signal-review text-signal-review-foreground hover:bg-signal-review/30'
                            : 'bg-popover hover:bg-card text-foreground'
                        }`}
                        title={showTasksPanel ? 'Back to terminal' : 'View vBRIEF tasks and dependency graph'}
                      >
                        <List className="w-4 h-4" />
                        {showTasksPanel ? 'Terminal' : 'Tasks'}
                      </button>
                      <button
                        onClick={handleAbortPlanning}
                        disabled={abortPlanningMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1 badge-bg-warning hover:bg-warning/20 text-warning-foreground text-sm rounded transition-colors disabled:opacity-50"
                        title="Stop planning and return to Todo"
                      >
                        <Square className="w-4 h-4" />
                        Stop
                      </button>
                      {/* Done appears only when the workspace plan reports completed planning state. Tmux liveness is not consulted — Stop kills the session, Done finalizes the plan. */}
                      {(statusQuery.data && statusQuery.data.hasCompletionMarker) && (
                        <button
                          onClick={() => {
                            stopPlanningMutation.mutate();
                            statusQuery.refetch();
                          }}
                          disabled={stopPlanningMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1 badge-bg-success hover:bg-success/20 text-success-foreground text-sm rounded transition-colors disabled:opacity-50"
                          title="Done - mark planning complete"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Done
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Error step */}
              {step === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="w-16 h-16 rounded-full badge-bg-destructive flex items-center justify-center mb-4">
                    <AlertCircle className="w-10 h-10 text-destructive" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Planning Failed</h3>
                  <p className="text-destructive text-center max-w-md mb-2">{error}</p>
                  <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
                    The planning agent could not start. You can retry or abort to return the issue to Todo.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-popover hover:bg-card text-foreground rounded-lg transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleAbortPlanning}
                      disabled={abortPlanningMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 badge-bg-warning hover:bg-warning/20 text-warning-foreground rounded-lg transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      {abortPlanningMutation.isPending ? 'Aborting...' : 'Abort'}
                    </button>
                    <button
                      onClick={() => {
                        setError(null);
                        setStep('starting');
                        startPlanningMutation.mutate();
                      }}
                      disabled={startPlanningMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-signal-review hover:bg-signal-review/90 text-signal-review-foreground rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {startPlanningMutation.isPending ? 'Retrying...' : 'Retry'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Rnd>

      {/* BeadsDialog removed — Tasks panel is now inline (PAN-417) */}
    </div>
  );
}

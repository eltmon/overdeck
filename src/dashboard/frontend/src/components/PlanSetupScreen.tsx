import { CheckCircle2, Loader2, Circle, AlertCircle, GitBranch, FolderOpen, FileSearch, Cpu, Terminal } from 'lucide-react';

/** Progress event from the SSE stream. */
export interface SetupProgressEvent {
  step: number;
  total: number;
  label: string;
  detail: string;
  status: 'active' | 'complete' | 'error';
}

interface PlanSetupScreenProps {
  issueIdentifier: string;
  issueTitle: string;
  steps: SetupProgressEvent[];
  error?: string | null;
}

const STEP_ICONS = [GitBranch, FolderOpen, FileSearch, Cpu, Terminal];
const STEP_LABELS = [
  'Creating workspace',
  'Preparing planning environment',
  'Loading specs & PRDs',
  'Configuring agent',
  'Launching planning session',
];

function StepRow({ stepNum, event }: { stepNum: number; event?: SetupProgressEvent }) {
  const Icon = STEP_ICONS[stepNum - 1] || Circle;
  const defaultLabel = STEP_LABELS[stepNum - 1] || `Step ${stepNum}`;

  const isActive = event?.status === 'active';
  const isComplete = event?.status === 'complete';
  const isError = event?.status === 'error';
  const isPending = !event;

  return (
    <div className={`flex items-start gap-4 transition-opacity duration-300 ${isPending ? 'opacity-35' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 transition-colors duration-300 ${
        isComplete ? 'bg-green-500/20' :
        isActive ? 'bg-purple-500/20' :
        isError ? 'bg-red-500/20' :
        'border border-divider'
      }`}>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-green-400" />}
        {isActive && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
        {isError && <AlertCircle className="w-4 h-4 text-red-400" />}
        {isPending && <Circle className="w-4 h-4 text-content-muted" />}
      </div>
      <div className="flex-1 py-1">
        <p className={`text-sm font-medium transition-colors duration-300 ${
          isComplete ? 'text-green-400' :
          isActive ? 'text-content' :
          isError ? 'text-red-400' :
          'text-content-muted'
        }`}>
          {event?.label || defaultLabel}
        </p>
        {event?.detail && (
          <p className={`text-xs mt-0.5 font-mono ${
            isError ? 'text-red-400/80' : 'text-content-muted'
          }`}>
            {event.detail}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 mt-1.5">
        <Icon className={`w-4 h-4 ${
          isComplete ? 'text-green-400/50' :
          isActive ? 'text-purple-400/50' :
          isError ? 'text-red-400/50' :
          'text-content-muted/30'
        }`} />
      </div>
    </div>
  );
}

export function PlanSetupScreen({ issueIdentifier, issueTitle, steps, error }: PlanSetupScreenProps) {
  const totalSteps = STEP_LABELS.length;
  const completedCount = steps.filter(s => s.status === 'complete').length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  // Map step events by step number for O(1) lookup
  const stepMap = new Map<number, SetupProgressEvent>();
  for (const s of steps) {
    stepMap.set(s.step, s);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      {/* Hero area */}
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center mb-6">
        <Terminal className="w-10 h-10 text-purple-400" />
      </div>

      <h3 className="text-xl font-semibold text-content mb-1">Setting up planning session</h3>
      <p className="text-sm text-content-subtle mb-8">
        {issueIdentifier}: {issueTitle}
      </p>

      {/* Step timeline */}
      <div className="w-full max-w-md space-y-4 mb-8">
        {STEP_LABELS.map((_, i) => (
          <StepRow
            key={i + 1}
            stepNum={i + 1}
            event={stepMap.get(i + 1)}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="flex justify-between text-xs text-content-muted mb-2">
          <span>Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="w-full h-1.5 bg-surface-overlay rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-6 w-full max-w-md bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Setup failed</p>
              <p className="text-xs text-red-400/80 mt-1 font-mono">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

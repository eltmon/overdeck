import { CheckCircle2, Loader2, Circle, AlertCircle, GitBranch, FolderOpen, FileSearch, Cpu, Terminal, Package, Wrench, Container } from 'lucide-react';

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

// Icons for workspace sub-steps (matched by label prefix)
const SUB_STEP_ICONS: Record<string, typeof GitBranch> = {
  'Creating git worktree': GitBranch,
  'Installing dependencies': Package,
  'Building workspace packages': Wrench,
  'Installing skills': FolderOpen,
  'Starting Docker': Container,
};

function getSubStepIcon(label: string) {
  for (const [prefix, Icon] of Object.entries(SUB_STEP_ICONS)) {
    if (label.startsWith(prefix)) return Icon;
  }
  return Circle;
}

function StatusIndicator({ status }: { status: 'active' | 'complete' | 'error' | 'pending' }) {
  if (status === 'complete') return <CheckCircle2 className="w-4 h-4 text-success" />;
  if (status === 'active') return <Loader2 className="w-4 h-4 text-signal-review animate-spin" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-destructive" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

function StepRow({ stepNum, event, subSteps }: { stepNum: number; event?: SetupProgressEvent; subSteps?: SetupProgressEvent[] }) {
  const Icon = STEP_ICONS[stepNum - 1] || Circle;
  const defaultLabel = STEP_LABELS[stepNum - 1] || `Step ${stepNum}`;

  const isActive = event?.status === 'active';
  const isComplete = event?.status === 'complete';
  const isError = event?.status === 'error';
  const isPending = !event;
  const hasSubSteps = subSteps && subSteps.length > 0;

  return (
    <div>
      <div className={`flex items-start gap-4 transition-opacity duration-300 ${isPending ? 'opacity-35' : ''}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 transition-colors duration-300 ${
          isComplete ? 'badge-bg-success' :
          isActive ? 'badge-bg-secondary' :
          isError ? 'badge-bg-destructive' :
          'border border-border'
        }`}>
          <StatusIndicator status={isPending ? 'pending' : event!.status} />
        </div>
        <div className="flex-1 py-1">
          <p className={`text-sm font-medium transition-colors duration-300 ${
            isComplete ? 'text-success' :
            isActive ? 'text-foreground' :
            isError ? 'text-destructive' :
            'text-muted-foreground'
          }`}>
            {event?.label || defaultLabel}
          </p>
          {event?.detail && !hasSubSteps && (
            <p className={`text-xs mt-0.5 font-mono ${
              isError ? 'text-destructive/80' : 'text-muted-foreground'
            }`}>
              {event.detail}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 mt-1.5">
          <Icon className={`w-4 h-4 ${
            isComplete ? 'text-success/50' :
            isActive ? 'text-signal-review/50' :
            isError ? 'text-destructive/50' :
            'text-muted-foreground/30'
          }`} />
        </div>
      </div>

      {/* Sub-steps (indented under main step) */}
      {hasSubSteps && (
        <div className="ml-12 mt-2 space-y-2 border-l border-border pl-4">
          {subSteps.map((sub, i) => {
            const SubIcon = getSubStepIcon(sub.label);
            return (
              <div key={i} className={`flex items-start gap-3 transition-opacity duration-200 ${sub.status === 'active' ? '' : sub.status === 'complete' ? 'opacity-70' : 'opacity-40'}`}>
                <SubIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${
                  sub.status === 'complete' ? 'text-success/60' :
                  sub.status === 'active' ? 'text-signal-review' :
                  'text-muted-foreground/40'
                }`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-xs ${
                    sub.status === 'complete' ? 'text-success/80' :
                    sub.status === 'active' ? 'text-foreground' :
                    'text-muted-foreground'
                  }`}>
                    {sub.label}
                  </span>
                  {sub.detail && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground font-mono leading-tight">
                        {sub.detail}
                      </span>
                      {sub.status === 'active' && <Loader2 className="w-3 h-3 text-signal-review animate-spin flex-shrink-0" />}
                      {sub.status === 'complete' && <CheckCircle2 className="w-3 h-3 text-success/60 flex-shrink-0" />}
                    </div>
                  )}
                  {!sub.detail && sub.status === 'active' && (
                    <Loader2 className="w-3 h-3 text-signal-review animate-spin mt-0.5" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PlanSetupScreen({ issueIdentifier, issueTitle, steps, error }: PlanSetupScreenProps) {
  const totalSteps = STEP_LABELS.length;
  const completedCount = steps.filter(s => s.step > 0 && s.status === 'complete' && s.label === STEP_LABELS[s.step - 1]).length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  // Separate main step events from sub-step events
  // Main steps: events where label matches STEP_LABELS[step-1] (exact step label)
  // Sub-steps: events for step 1 with labels that don't match "Creating workspace"
  const mainStepMap = new Map<number, SetupProgressEvent>();
  const subStepsMap = new Map<number, SetupProgressEvent[]>();

  for (const s of steps) {
    const expectedLabel = STEP_LABELS[s.step - 1];
    if (s.label === expectedLabel) {
      // This is a main step event
      mainStepMap.set(s.step, s);
    } else {
      // This is a sub-step (e.g., workspace creation sub-steps)
      const existing = subStepsMap.get(s.step) || [];
      const idx = existing.findIndex(e => e.label === s.label);
      if (idx >= 0) {
        existing[idx] = s;
      } else {
        existing.push(s);
      }
      subStepsMap.set(s.step, existing);
    }
  }

  // If step 1 has sub-steps but no main step event yet, synthesize an active main step
  if (subStepsMap.has(1) && !mainStepMap.has(1)) {
    const subs = subStepsMap.get(1)!;
    const allComplete = subs.every(s => s.status === 'complete');
    mainStepMap.set(1, {
      step: 1,
      total: totalSteps,
      label: STEP_LABELS[0],
      detail: '',
      status: allComplete ? 'complete' : 'active',
    });
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      {/* Hero area */}
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center mb-6">
        <Terminal className="w-10 h-10 text-signal-review" />
      </div>

      <h3 className="text-xl font-semibold text-foreground mb-1">Setting up planning session</h3>
      <p className="text-sm text-muted-foreground mb-8">
        {issueIdentifier}: {issueTitle}
      </p>

      {/* Step timeline */}
      <div className="w-full max-w-md space-y-4 mb-8">
        {STEP_LABELS.map((_, i) => (
          <StepRow
            key={i + 1}
            stepNum={i + 1}
            event={mainStepMap.get(i + 1)}
            subSteps={subStepsMap.get(i + 1)}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="w-full h-1.5 bg-popover rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-6 w-full max-w-md badge-bg-destructive border border-destructive/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Setup failed</p>
              <p className="text-xs text-destructive/80 mt-1 font-mono">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

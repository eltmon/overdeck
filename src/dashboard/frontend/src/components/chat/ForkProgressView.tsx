import { AlertCircle, CheckCircle2, Circle, GitBranchPlus, Loader2 } from 'lucide-react';
import styles from '../CommandDeck/styles/command-deck.module.css';

const FORK_STEPS = [
  { key: 'summarizing', label: 'Summarizing', description: 'Generating a concise summary of the parent conversation' },
  { key: 'spawning',    label: 'Spawning',    description: 'Starting a new Claude Code session' },
  { key: 'injecting',   label: 'Injecting',   description: 'Seeding the new session with conversation context' },
] as const;

export function ForkProgressView({ forkStatus, forkError, parentTitle }: {
  forkStatus: string;
  forkError?: string | null;
  parentTitle?: string;
}) {
  const isFailed = forkStatus === 'failed';
  const activeIdx = FORK_STEPS.findIndex((s) => s.key === forkStatus);

  return (
    <div className={styles.forkProgressView}>
      <div className={styles.forkProgressCard}>
        <div className={styles.forkProgressHeader}>
          <GitBranchPlus size={20} className={styles.forkProgressIcon} />
          <div>
            <h3 className={styles.forkProgressTitle}>
              {isFailed ? 'Fork Failed' : 'Setting up fork…'}
            </h3>
            {parentTitle && (
              <p className={styles.forkProgressSubtitle}>
                Forking from <strong>{parentTitle}</strong>
              </p>
            )}
          </div>
        </div>

        <div className={styles.forkProgressTimeline}>
          {FORK_STEPS.map((step, i) => {
            let state: 'done' | 'active' | 'pending' | 'failed';
            if (isFailed) {
              state = i < activeIdx ? 'done' : i === activeIdx || (activeIdx === -1 && i === 0) ? 'failed' : 'pending';
            } else {
              state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
            }

            return (
              <div key={step.key} className={`${styles.forkProgressStep} ${styles[`forkProgressStep--${state}`]}`}>
                <div className={styles.forkProgressStepIndicator}>
                  {state === 'done' && <CheckCircle2 size={18} />}
                  {state === 'active' && <Loader2 size={18} className={styles.forkProgressSpinner} />}
                  {state === 'pending' && <Circle size={18} />}
                  {state === 'failed' && <AlertCircle size={18} />}
                  {i < FORK_STEPS.length - 1 && <div className={styles.forkProgressStepLine} />}
                </div>
                <div className={styles.forkProgressStepContent}>
                  <span className={styles.forkProgressStepLabel}>{step.label}</span>
                  <span className={styles.forkProgressStepDesc}>{step.description}</span>
                </div>
              </div>
            );
          })}
        </div>

        {isFailed && forkError && (
          <div className={styles.forkProgressError}>
            <AlertCircle size={14} />
            <span>{forkError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

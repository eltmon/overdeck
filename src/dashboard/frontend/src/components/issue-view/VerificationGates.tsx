import { cn } from '../../lib/utils';
import { useIssueView } from './useIssueView';
import { VERIFICATION_GATES_SECTIONS } from './inventory';
import type { IssueVerificationModel, VerificationGateModel } from './types';

const GATE_TONE_CLASSES: Record<VerificationGateModel['status'], string> = {
  passed: 'border-success/40 bg-success/10 text-success-foreground',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive-foreground',
  running: 'border-info/40 bg-info/10 text-info-foreground',
  skipped: 'border-muted text-muted-foreground',
  pending: 'border-muted text-muted-foreground',
  'infra-unavailable': 'border-muted text-muted-foreground',
};

const GATE_STATUS_LABEL: Record<VerificationGateModel['status'], string> = {
  passed: 'pass',
  failed: 'fail',
  running: 'running',
  skipped: 'skipped',
  pending: 'pending',
  'infra-unavailable': 'unavailable',
};

interface VerificationGatesProps {
  verification: IssueVerificationModel;
}

function VerificationGatesGrid({ verification }: VerificationGatesProps) {
  return (
    <section
      data-testid="verification-gates"
      data-section={VERIFICATION_GATES_SECTIONS[0]}
      className="rounded-[var(--radius)] border border-border bg-card p-[14px]"
    >
      <div className="mb-[10px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Verification Gates
        {verification.cycle ? <span className="ml-2 normal-case">{verification.cycle}</span> : null}
      </div>
      <div className="grid grid-cols-4 gap-[8px]">
        {verification.gates.map((gate) => (
          <div
            key={gate.id}
            data-testid={`verification-gate-${gate.id}`}
            data-section={VERIFICATION_GATES_SECTIONS[1]}
            data-gate-id={gate.id}
            data-gate-status={gate.status}
            className={cn('rounded-[10px] border bg-background/45 px-[12px] py-[10px]', GATE_TONE_CLASSES[gate.status])}
          >
            <div className="text-[14px] font-medium leading-none">{GATE_STATUS_LABEL[gate.status]}</div>
            <div className="mt-[6px] font-mono text-[10px] uppercase leading-none text-muted-foreground">{gate.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function VerificationGates({ issueId }: { issueId: string }) {
  const { verification } = useIssueView(issueId);
  return <VerificationGatesGrid verification={verification} />;
}

export { VerificationGatesGrid };

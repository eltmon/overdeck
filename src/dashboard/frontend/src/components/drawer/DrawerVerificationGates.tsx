import { cn } from '../../lib/utils';
import { useDrawerData, type DrawerVerificationGateStatus } from './useDrawerData';

const GATE_TONE_CLASSES = {
  passed: 'drawer-gate-border-pass text-success-foreground',
  failed: 'drawer-gate-border-fail text-destructive-foreground',
  running: 'badge-border-info text-info-foreground',
  skipped: 'badge-border-muted text-muted-foreground',
  pending: 'badge-border-muted text-muted-foreground',
} satisfies Record<DrawerVerificationGateStatus, string>;

export default function DrawerVerificationGates() {
  const { verificationGates } = useDrawerData();

  return (
    <section data-component="drawer-verification-gates" data-testid="drawer-verification-gates" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <div className="mb-[10px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Verification Gates</div>
      <div className="grid grid-cols-4 gap-[8px]">
        {verificationGates.map((gate) => (
          <div
            key={gate.id}
            data-testid={`drawer-verification-gate-${gate.id}`}
            className={cn('rounded-[10px] border bg-background/45 px-[12px] py-[10px]', GATE_TONE_CLASSES[gate.status])}
          >
            <div className="text-[14px] font-medium leading-none">{gate.detail}</div>
            <div className="mt-[6px] font-mono text-[10px] uppercase leading-none text-muted-foreground">{gate.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

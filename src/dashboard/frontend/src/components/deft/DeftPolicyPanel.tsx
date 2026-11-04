/**
 * Deft's merge and review policy, read-only (PAN-4849 WI-7). The value that
 * gates auto-merge, `requireHumanMerge`, comes first.
 */
import type { DeftPolicy } from '@overdeck/contracts';

function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function DeftPolicyPanel({ policy }: { policy: DeftPolicy }) {
  const rest = Object.entries(policy.raw).filter(([key]) => key !== 'requireHumanMerge');
  return (
    <dl data-section="Deft policy" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
      <dt className="text-muted-foreground">requireHumanMerge</dt>
      <dd className="font-mono text-foreground">{String(policy.requireHumanMerge)}</dd>
      {rest.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-all font-mono text-foreground">{show(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

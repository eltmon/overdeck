import { useState } from 'react';
import type { ResourceStack } from '../../types';
import type { MachineRoomGroupBy } from './MachineRoomTopbar';
import { StackCard } from './StackCard';
import type { ServiceAction, StackAction } from './StackActions';

interface StacksSectionProps {
  stacks: ResourceStack[];
  filter: string;
  groupBy: MachineRoomGroupBy;
  busyKeys?: ReadonlySet<string>;
  onStackAction?: (stack: ResourceStack, action: StackAction) => void;
  onServiceAction?: (service: ResourceStack['services'][number], action: ServiceAction) => void;
  onServiceLogs?: (service: ResourceStack['services'][number]) => void;
  onServiceTerminal?: (service: ResourceStack['services'][number]) => void;
  onTeardown?: (stack: ResourceStack) => void;
}

export function StacksSection({
  stacks,
  filter,
  groupBy,
  busyKeys,
  onStackAction,
  onServiceAction,
  onServiceLogs,
  onServiceTerminal,
  onTeardown,
}: StacksSectionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const filtered = stacks.filter((stack) => matchesStack(stack, filter));
  const groups = groupStacks(filtered, groupBy);

  return (
    <div className="mb-6 space-y-5">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2 font-['DM_Mono'] text-xs uppercase text-muted-foreground">
            {group.label} · {group.stacks.length}
          </h2>
          <div className="space-y-3">
            {group.stacks.map((stack) => (
              <StackCard
                key={stack.id}
                stack={stack}
                expanded={expanded.has(stack.id)}
                busyKeys={busyKeys}
                onStackAction={onStackAction}
                onServiceAction={onServiceAction}
                onServiceLogs={onServiceLogs}
                onServiceTerminal={onServiceTerminal}
                onTeardown={onTeardown}
                onToggle={(stackId) => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(stackId)) next.delete(stackId);
                    else next.add(stackId);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupStacks(stacks: ResourceStack[], groupBy: MachineRoomGroupBy) {
  if (groupBy === 'flat') return [{ key: 'flat', label: 'All stacks', stacks }];
  const groups = new Map<string, ResourceStack[]>();
  for (const stack of stacks) {
    const key = groupBy === 'kind' ? stack.phase : stack.issueId ?? 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), stack]);
  }
  return [...groups.entries()].map(([key, groupStacks]) => ({ key, label: key, stacks: groupStacks }));
}

function matchesStack(stack: ResourceStack, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return [
    stack.id,
    stack.issueId ?? '',
    stack.issueTitle,
    stack.composeProject,
    stack.phase,
    ...stack.services.map((service) => service.name),
  ].some((value) => value.toLowerCase().includes(query));
}

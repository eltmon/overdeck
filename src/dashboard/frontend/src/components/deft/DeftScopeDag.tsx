/**
 * Deft's scope dependencies in the cockpit Plan › Map view (PAN-4849 WI-12,
 * BD-1): one node per scope, edges from each scope's swarm `depends_on`,
 * drawn with the shared DAG renderer, plus each scope's file scope.
 */
import type { DeftScope } from '@overdeck/contracts';
import { CockpitCard } from '../Stage/cockpit/CockpitCard';
import { DagRenderer, type DagEdge, type DagNode } from '../xbrief/DagRenderer';
import { useDeftIssueState } from './queries';

const FOLDER_STATUS: Partial<Record<DeftScope['folder'], DagNode['status']>> = {
  completed: 'done',
  active: 'in-progress',
  cancelled: 'blocked',
};

export function deftScopesToDag(scopes: DeftScope[]): { nodes: DagNode[]; edges: DagEdge[] } {
  const known = new Set(scopes.map((scope) => scope.planId));
  const nodes = scopes.map((scope): DagNode => ({
    id: scope.planId,
    title: `${scope.title || scope.planId}${scope.swarm?.conflictGroup ? ` [${scope.swarm.conflictGroup}]` : ''}`,
    status: FOLDER_STATUS[scope.folder] ?? 'waiting',
  }));
  const edges = scopes.flatMap((scope) =>
    (scope.swarm?.dependsOn ?? []).filter((dep) => known.has(dep)).map((dep): DagEdge => ({ from: dep, to: scope.planId })));
  return { nodes, edges };
}

export function DeftScopeDag({ issueId }: { issueId: string }) {
  const { data: state } = useDeftIssueState(issueId);
  if (!state || state.scopes.length === 0) return null;
  const { nodes, edges } = deftScopesToDag(state.scopes);
  const withFiles = state.scopes.filter((scope) => (scope.swarm?.fileScope.length ?? 0) > 0);
  return (
    <CockpitCard tone="muted" title="Deft scopes" className="mb-3.5">
      <div data-section="Deft scope DAG">
        <DagRenderer nodes={nodes} edges={edges} compact showLegend />
        {withFiles.length > 0 ? (
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {withFiles.map((scope) => <li key={scope.planId}>{scope.planId}: {scope.swarm!.fileScope.join(', ')}</li>)}
          </ul>
        ) : null}
      </div>
    </CockpitCard>
  );
}

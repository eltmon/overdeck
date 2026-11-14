import { useState } from 'react';
import { ChevronRight, ChevronDown, ExternalLink, GitBranch } from 'lucide-react';
import { useWorkspaceQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useIssueActions, type IssueActionView } from '../IssueActionMenu/useIssueActions';
import { UatStackStatus, getUatStackSummary } from '../CommandDeck/UatStackStatus';
import styles from '../Stage/cockpit/agentsLane.module.css';

/**
 * StackDrawer (PAN-5253) — a shell-independent copy of
 * Stage/cockpit/AgentsLane.tsx's StackDrawer, for the shared issue view's
 * Details workspace section: the workspace stack's health summary, service
 * URLs, live per-container status (reusing UatStackStatus), git
 * ahead/behind/dirty, and the registry stack actions.
 */
export function StackDrawer({
  issueId,
  branch,
}: {
  issueId: string;
  branch: string;
}) {
  const [open, setOpen] = useState(false);
  const ws = useWorkspaceQuery(issueId).data;
  const actions = useIssueActions(issueId);
  if (!ws?.exists) return null;

  const containers = ws?.containers ?? null;
  const stackHealth = ws?.stackHealth;
  const summary = getUatStackSummary({ containers, stackHealth });
  const total = summary?.totalCount ?? 0;
  const unhealthy = !!summary && (stackHealth?.healthy === false || summary.healthyCount < summary.totalCount);
  const healthClass = !summary ? 'bg-muted-foreground' : unhealthy ? 'bg-destructive' : 'bg-success';

  const git = ws?.git;
  const branchName = git?.branch ?? branch;
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;

  const services = (ws?.services?.filter((s) => s.url) ?? []).slice();
  if (services.length === 0) {
    if (ws?.frontendUrl) services.push({ name: 'Frontend', url: ws.frontendUrl });
    if (ws?.apiUrl) services.push({ name: 'API', url: ws.apiUrl });
  }

  const stackActions = ['rebuildAndStart', 'syncMain', 'createWorkspace']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .filter((v): v is IssueActionView => !!v && (v.enabled || v.blockedOffline));

  return (
    <div className={styles.resources} data-section="StackDrawer">
      <button
        type="button"
        className={styles.resToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Stack
        <span className="inline-flex items-center gap-[6px]">
          <span className={`${styles.dot} ${healthClass}`} />
          {total > 0 ? `${total} ctr` : 'no ctr'}{ahead > 0 ? ` · +${ahead}` : ''}
        </span>
      </button>
      {open && (
        <div className={styles.resList}>
          {services.length > 0 && (
            <>
              <div className={styles.resSub}>Services</div>
              <div className={`${styles.resRow} gap-[12px]`}>
                {services.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className={styles.resLink}>
                    {s.name} <ExternalLink size={11} />
                  </a>
                ))}
              </div>
            </>
          )}

          {(containers || stackHealth) && (
            <>
              <div className={styles.resSub}>Containers{total ? ` · ${total}` : ''}</div>
              <UatStackStatus density="compact" containers={containers} stackHealth={stackHealth} frontendUrl={ws?.frontendUrl} apiUrl={ws?.apiUrl} />
            </>
          )}

          <div className={styles.resSub}>Git</div>
          <div className={styles.resRow}>
            <GitBranch className="ri" />
            <span className="font-mono-ui text-[10px]">{branchName}</span>
            <span className="rmeta">
              {ahead > 0 ? `+${ahead}` : ''}{behind > 0 ? ` -${behind}` : ''}{git?.dirty ? ' dirty' : (!ahead && !behind ? 'clean' : '')}
            </span>
          </div>

          {stackActions.length > 0 && (
            <div className={styles.resActions}>
              {stackActions.map((v) => (
                <button key={v.action.key} type="button" disabled={v.isPending || v.blockedOffline} title={v.blockedOffline ? v.disabledReason : undefined} onClick={v.invoke} className={styles.resBtn}>
                  {v.action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Fragment, useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { UatStackStatus, type getUatStackSummary } from '../UatStackStatus';
import { resolveUatActions, type UatAction, type UatIssueLifecycle } from '../uat-actions';
import type { WorkspaceData } from '../ZoneCOverviewTabs/queries';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDestructiveItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '../../shared/ContextMenu';
import styles from '../styles/command-deck.module.css';

type UatStackSummary = NonNullable<ReturnType<typeof getUatStackSummary>>;

interface UatStackTreeGroupProps {
  summary: UatStackSummary;
  workspace?: WorkspaceData;
  pending: boolean;
  storageKey: string;
  issueLifecycle?: UatIssueLifecycle;
  onActionSelect?: (action: UatAction) => void;
}

function readExpanded(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function writeExpanded(storageKey: string, expanded: boolean): void {
  try {
    if (expanded) {
      localStorage.setItem(storageKey, 'true');
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // ignore
  }
}

function actionClassName(action: UatAction): string {
  const toneClass = action.tone === 'primary'
    ? styles.uatStackActionPrimary
    : action.tone === 'danger'
      ? styles.uatStackActionDanger
      : styles.uatStackActionMuted;
  return `${styles.uatStackActionButton} ${toneClass}`;
}

export function UatStackTreeGroup({ summary, workspace, pending, storageKey, issueLifecycle = 'active', onActionSelect }: UatStackTreeGroupProps) {
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const actions = resolveUatActions(summary.state, issueLifecycle);
  const handleActionSelect = useCallback((action: UatAction) => {
    onActionSelect?.(action);
  }, [onActionSelect]);
  const handleToggle = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      writeExpanded(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return (
    <div className={styles.uatStackTreeGroup}>
      <ContextMenuRoot>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className={styles.uatStackTreeHeader}
            onClick={handleToggle}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleToggle();
            }}
            aria-expanded={expanded}
            aria-label="Toggle UAT environment details"
            title="Toggle UAT environment details"
            data-testid="uat-stack-tree-header"
            onContextMenu={(event) => event.stopPropagation()}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>UAT environment</span>
            <span className={styles.uatStackTreeSummary}>{summary.label.replace(/^UAT stack\s*/i, '')}</span>
            <span className={styles.uatStackActions} aria-label="UAT actions">
              {actions.inline.map(action => (
                <button
                  key={action.id}
                  type="button"
                  className={actionClassName(action)}
                  data-testid={`uat-inline-action-${action.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleActionSelect(action);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>UAT actions</ContextMenuLabel>
          {actions.menu.map((action, index) => {
            const isReap = action.id === 'reap';
            const item = isReap ? (
              <ContextMenuDestructiveItem key={action.id} onSelect={() => handleActionSelect(action)}>
                {action.label}
              </ContextMenuDestructiveItem>
            ) : (
              <ContextMenuItem key={action.id} onSelect={() => handleActionSelect(action)}>
                {action.label}
              </ContextMenuItem>
            );

            if (isReap && index > 0) {
              return (
                <Fragment key={action.id}>
                  <ContextMenuSeparator />
                  {item}
                </Fragment>
              );
            }
            return item;
          })}
        </ContextMenuContent>
      </ContextMenuRoot>
      {expanded && (
        <UatStackStatus
          containers={workspace?.containers}
          stackHealth={workspace?.stackHealth}
          frontendUrl={workspace?.frontendUrl}
          apiUrl={workspace?.apiUrl}
          pending={pending}
          density="tree"
        />
      )}
    </div>
  );
}

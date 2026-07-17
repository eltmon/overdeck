import {
  ContextMenuContent,
  ContextMenuDestructiveItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '../shared/ContextMenu';
import {
  IssueActionGroupedBody,
  type IssueActionGroupedBodyProps,
  type IssueActionMenuItemPrimitiveProps,
  type IssueActionMenuPrimitives,
  type NonIssueActionInvocation,
} from './IssueActionGroupedBody';

export type { NonIssueActionInvocation } from './IssueActionGroupedBody';

export type GroupedIssueActionMenuProps = Omit<IssueActionGroupedBodyProps, 'primitives'> & {
  'data-section'?: string;
};

function ContextMenuItemPrimitive({
  onActivate,
  preventClose,
  ...props
}: IssueActionMenuItemPrimitiveProps) {
  return (
    <ContextMenuItem
      {...props}
      onSelect={(event) => {
        if (preventClose) event.preventDefault();
        onActivate?.();
      }}
    />
  );
}

function ContextMenuDestructiveItemPrimitive({
  onActivate,
  preventClose,
  ...props
}: IssueActionMenuItemPrimitiveProps) {
  return (
    <ContextMenuDestructiveItem
      {...props}
      onSelect={(event) => {
        if (preventClose) event.preventDefault();
        onActivate?.();
      }}
    />
  );
}

const contextMenuPrimitives: IssueActionMenuPrimitives = {
  Item: ContextMenuItemPrimitive,
  DestructiveItem: ContextMenuDestructiveItemPrimitive,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
};

export function GroupedIssueActionMenu({
  actions,
  nonIssueActions,
  defaultExplain,
  'data-section': dataSection,
}: GroupedIssueActionMenuProps) {
  return (
    <ContextMenuContent className="w-[320px] font-sans" data-section={dataSection}>
      <IssueActionGroupedBody
        actions={actions}
        primitives={contextMenuPrimitives}
        nonIssueActions={nonIssueActions}
        defaultExplain={defaultExplain}
      />
    </ContextMenuContent>
  );
}

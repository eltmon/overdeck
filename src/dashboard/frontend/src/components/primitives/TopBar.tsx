import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

export type TopBarHeight = 52 | 48;

export type TopBarProps = {
  height?: TopBarHeight;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
  search?: ReactNode;
  segmentedControl?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const HEIGHT_CLASSES = {
  52: 'h-[52px]',
  48: 'h-[48px]',
} satisfies Record<TopBarHeight, string>;

/** Reusable button class names for elements placed in the actions slot. */
export const topBarButtonClasses = {
  primary: 'btn-chrome-primary',
  ghost: 'btn-chrome-ghost',
} as const;

export default function TopBar({
  height = 52,
  breadcrumb,
  meta,
  search,
  segmentedControl,
  actions,
  className,
}: TopBarProps) {
  const hasLeft = Boolean(breadcrumb || meta);
  const hasRight = Boolean(search || actions);

  return (
    <div
      data-component="top-bar"
      data-height={height}
      className={cn(
        'flex shrink-0 items-center gap-[12px] border-b border-border bg-background px-[22px]',
        HEIGHT_CLASSES[height],
        className,
      )}
    >
      {hasLeft && (
        <div className="flex min-w-0 items-center gap-[8px]">
          {breadcrumb && (
            <span className="truncate text-[13px] font-medium leading-none text-foreground">
              {breadcrumb}
            </span>
          )}
          {meta && (
            <span className="truncate text-[12px] leading-none text-muted-foreground">
              {meta}
            </span>
          )}
        </div>
      )}

      {segmentedControl && (
        <div className="mx-auto flex items-center">
          {segmentedControl}
        </div>
      )}

      {hasRight && (
        <div className="ml-auto flex items-center gap-[8px]">
          {search && <div className="flex items-center">{search}</div>}
          {actions && <div className="flex items-center gap-[6px]">{actions}</div>}
        </div>
      )}
    </div>
  );
}

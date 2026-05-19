import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

type TopBarProps = {
  title?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  height?: string;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
  search?: ReactNode;
  segmentedControl?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function TopBar({
  title,
  eyebrow,
  right,
  height = 'h-[52px]',
  breadcrumb,
  meta,
  search,
  segmentedControl,
  actions,
  className,
}: TopBarProps) {
  const actionSlot = actions ?? right;

  return (
    <header
      data-component="top-bar"
      className={cn(
        'flex shrink-0 items-center gap-[12px] border-b border-border bg-background px-[22px]',
        height,
        className,
      )}
    >
      <div data-component="top-bar-breadcrumb" className="min-w-0">
        {breadcrumb ?? eyebrow ? (
          <div className="mb-[4px] truncate text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground">
            {breadcrumb ?? eyebrow}
          </div>
        ) : null}
        {title && <h1 className="truncate text-[18px] font-semibold leading-none text-foreground">{title}</h1>}
      </div>
      {meta && <div data-component="top-bar-meta" className="min-w-0 text-[12px] text-muted-foreground">{meta}</div>}
      {search && <div data-component="top-bar-search" className="min-w-[220px] flex-1">{search}</div>}
      {segmentedControl && <div data-component="top-bar-segmented-control" className="shrink-0">{segmentedControl}</div>}
      {actionSlot && <div data-component="top-bar-actions" className="ml-auto min-w-0">{actionSlot}</div>}
    </header>
  );
}
